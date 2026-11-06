// The coordinator: validates messages, reads the page, owns workflow + safety state, and builds the panel view.
// All Chrome access is injected, so this logic is testable and every call re-loads state (the worker may be suspended).
import { MSG, validateMessage } from '../communication/message-contracts.js';
import { parseCommand } from '../commands/command-parser.js';
import { runCommand, NEED_ACCESS } from '../commands/command-handlers.js';
import { WorkflowEngine } from '../workflow/workflow-engine.js';
import { applyStage } from '../workflow/step-manager.js';
import { loadWorkflowState, saveWorkflowState } from '../workflow/workflow-state.js';
import { TransactionManager, KINDS } from '../safety/transaction-manager.js';
import { ConfirmationGate } from '../safety/confirmation-gate.js';

export const TX_KEY = 'pws.tx.v1';
const READBACK_NOTE = 'read back at your request, kept on this device only';

/**
 * @param {object} deps
 * @param {{ids:object, local:object, session:object, bridge:object, provider:object, workflow:object, now?:()=>number, notifyPanel?:()=>void}} deps
 *   bridge.ensure() -> {ok, href} | {ok:false, problem};  bridge.send(type, payload) -> response object
 */
export function createCoordinator({ ids, local, session, bridge, provider, workflow, now = () => Date.now(), notifyPanel = () => {} }) {
  const engine = new WorkflowEngine(workflow);
  const stageOfKind = (kind) => workflow.stages.find((s) => s.consequential === kind) ?? null;

  // One operation at a time: load, change and save must not interleave between events.
  let queue = Promise.resolve();
  const serialise = (fn) => {
    const run = queue.then(fn, fn);
    queue = run.catch(() => {});
    return run;
  };

  async function loadTx() {
    const raw = await session.get(TX_KEY);
    const tm = new TransactionManager({ gate: new ConfirmationGate({ now }), now, prerequisites: workflow.prerequisites });
    tm.hydrate(raw);
    const readBacks = raw && typeof raw.readBacks === 'object' && raw.readBacks ? { ...raw.readBacks } : {};
    return { tm, readBacks };
  }
  async function saveTx(tx) {
    await session.set(TX_KEY, { ...tx.tm.serialize(), readBacks: tx.readBacks });
  }

  // ---- reading the page ----------------------------------------------------------------------

  async function readPage() {
    const ens = await bridge.ensure();
    if (!ens.ok) return { ok: false, problem: ens.problem || NEED_ACCESS };
    const stageInfo = engine.identify(ens.href);
    const payload = stageInfo.matched
      ? { detailSelectors: workflow.detailSelectors, fingerprintSelectors: workflow.fingerprintSelectors }
      : {};
    const res = await bridge.send(MSG.DISCOVER, payload);
    if (!res?.ok || !res.result) return { ok: false, problem: NEED_ACCESS };
    return { ok: true, page: res.result, stageInfo };
  }

  // ---- transaction sync ----------------------------------------------------------------------

  function buildSubmissionReview(page, readBacks) {
    const lines = page.fields.map((f) => ({
      label: f.name,
      value: f.sensitive ? 'sensitive, not checked, you type it yourself' : f.filled ? 'filled' : 'empty',
    }));
    lines.push({ label: 'Application summary', value: 'shown on the page; I only watch it for changes' });
    for (const [name, value] of Object.entries(readBacks)) lines.push({ label: `${name} (${READBACK_NOTE})`, value: value || 'empty' });
    return { details: { stage: 'review', fingerprint: page.fingerprint }, lines };
  }

  function buildPaymentReview(page) {
    const d = page.details ?? {};
    const lines = [
      { label: 'Recipient', value: d.recipient ?? '' },
      { label: 'Amount', value: d.amount ?? '' },
      { label: 'Fees', value: d.fees ?? '' },
      { label: 'Total', value: d.total ?? '' },
      { label: 'Purpose', value: d.purpose ?? '' },
      { label: 'Card details', value: 'you type these yourself on the site; I never see them' },
    ];
    return { details: { recipient: d.recipient ?? '', amount: d.amount ?? '', fees: d.fees ?? '', total: d.total ?? '', purpose: d.purpose ?? '' }, lines };
  }

  /** Applies what was just observed to the safety state. Showing a review never authorises anything. */
  function syncTransactions(snap, stagePrev, tx) {
    const { tm } = tx;
    const stage = snap.stageInfo.stage;
    let blockedReason = null;

    // Leaving a consequential stage: forward by one step means the site accepted it; anything else cancels.
    const prevInfo = stagePrev ? engine.stageById(stagePrev) : null;
    if (prevInfo?.stage.consequential && stage && stage.id !== prevInfo.stage.id) {
      const kind = prevInfo.stage.consequential;
      const movedOn = engine.stageById(stage.id).index === prevInfo.index + 1;
      if (movedOn) {
        if (tm.state.pending?.kind === kind) tm.markExecuted(kind);
        else tm.noteCompleted(kind);
      }
    }
    // A review only lives on its own consequential stage; leaving that stage (or the site) drops it.
    if (tm.state.pending && stage?.consequential !== tm.state.pending.kind) tm.clearPending();
    if (stagePrev && stage && stagePrev !== stage.id) tx.readBacks = {};

    if (stage?.consequential) {
      const kind = stage.consequential;
      const review = kind === KINDS.PAYMENT ? buildPaymentReview(snap.page) : buildSubmissionReview(snap.page, tx.readBacks);
      const pending = tm.state.pending;
      if (!pending) {
        const res = tm.begin(kind, review.details, review.lines);
        if (!res.ok) blockedReason = res.reason;
      } else if (pending.status === 'activated') {
        if (snap.page.errors.length) tm.markFailed(kind, `The site reported a problem: ${snap.page.errors[0].text} Fix it, then confirm again.`);
      } else {
        const res = tm.update(kind, review.details, review.lines);
        if (!res.ok) blockedReason = res.reason;
      }
    }
    return blockedReason;
  }

  // ---- one observation: read page, update state ------------------------------------------------

  async function observe() {
    const snap = await readPage();
    const tx = await loadTx();
    let wf = await loadWorkflowState(local);
    let blockedReason = null;
    if (snap.ok) {
      const prev = wf.workflowId === workflow.id ? wf.stageId : null;
      blockedReason = snap.stageInfo.matched ? syncTransactions(snap, prev, tx) : null;
      if (!snap.stageInfo.matched && tx.tm.state.pending) tx.tm.clearPending();
      const next = applyStage(wf, workflow, snap.stageInfo, now());
      if (next !== wf) {
        wf = next;
        await saveWorkflowState(local, wf);
      }
    }
    await saveTx(tx);
    return { snap, tx, wf, blockedReason, prefs: await provider.getProfile() };
  }

  function buildView(obs) {
    const { snap, wf, tx, prefs, blockedReason } = obs;
    const matched = snap.ok && snap.stageInfo.matched;
    const stage = matched ? snap.stageInfo.stage : null;
    const index = stage ? snap.stageInfo.index : -1;
    // On another website the saved position is kept but not shown as the current stage.
    const progress = engine.progress(index);
    const instruction = matched
      ? engine.nextInstruction(stage, snap.page)
      : snap.ok
        ? 'This site has no guided steps. Say "where am I", "list fields", "go to" a label, or "next".'
        : snap.problem;
    const txView = tx.tm.getView();
    return {
      service: matched ? workflow.service : snap.ok ? 'Any website' : 'No page available',
      stage: stage ? { id: stage.id, title: stage.title } : null,
      progress,
      instruction,
      page: snap.ok ? { title: snap.page.title, counts: snap.page.counts } : null,
      problem: snap.ok ? null : snap.problem,
      prefs,
      savedPosition: wf.stageId ? { stageId: wf.stageId, furthestIndex: wf.furthestIndex } : null,
      transaction: { ...txView, blockedReason: txView.pending ? null : blockedReason },
    };
  }

  // ---- operations ------------------------------------------------------------------------------

  async function opGetView() {
    const obs = await observe();
    return { ok: true, view: buildView(obs) };
  }

  async function opCommand(text) {
    const parsed = parseCommand(text);
    const obs = await observe();
    const { snap, tx, prefs } = obs;
    let readBackChanged = false;
    let pageChanged = false;
    const ctx = {
      page: snap.ok ? snap.page : null,
      problem: snap.ok ? null : snap.problem,
      stageInfo: snap.ok ? snap.stageInfo : null,
      prefs,
      engine,
      workflow,
      focusControl: (id) => bridge.send(MSG.FOCUS, { fieldId: id }),
      // Plain clicks carry no grant: the content script refuses any consequential control without one.
      clickAction: (id) => bridge.send(MSG.CLICK, { actionId: id }),
      readBackValue: (id) => (prefs.readBackEnabled ? bridge.send(MSG.READ_BACK, { fieldId: id }) : { ok: false, reason: 'read_back_disabled' }),
      readText: (selector) => bridge.send(MSG.READ_TEXT, { selector }),
      fillValue: (id, value) => bridge.send(MSG.FILL, { fieldId: id, value }),
      // After a click, poll briefly for a new page or new errors. `snap` is the page as it was before the click.
      waitForPageChange: async () => {
        const sig = (s) => (s.ok
          ? [s.page.href, s.page.title, s.page.fields.map((f) => f.name).join(','), s.page.errors.map((e) => e.text).join(',')].join('|')
          : '');
        const before = sig(snap);
        for (let i = 0; i < 8; i++) {
          await new Promise((r) => setTimeout(r, 250));
          const next = await readPage();
          if (next.ok && sig(next) !== before) {
            pageChanged = true;
            return next;
          }
        }
        return null;
      },
      beginTransaction: async (kind) => {
        if (tx.tm.state.pending?.kind === kind) return { ok: true };
        return obs.blockedReason ? { ok: false, reason: obs.blockedReason } : { ok: false, reason: 'The review is not available on this page.' };
      },
      rememberReadBack: (name, value) => {
        tx.readBacks[name] = value;
        readBackChanged = true;
      },
    };
    const result = await runCommand(parsed, ctx);
    if (pageChanged) {
      // The page changed while the command ran, so the observation above is stale: observe again for the panel view.
      const fresh = await observe();
      return { ok: result.ok, message: result.message, lines: result.lines ?? null, focusConfirm: !!result.focusConfirm, view: buildView(fresh) };
    }
    if (readBackChanged && snap.ok && snap.stageInfo.stage?.consequential) {
      syncTransactions(snap, snap.stageInfo.stage.id, tx);
    }
    await saveTx(tx);
    return { ok: result.ok, message: result.message, lines: result.lines ?? null, focusConfirm: !!result.focusConfirm, view: buildView(obs) };
  }

  async function opConfirm(kind) {
    const obs = await observe();
    const { snap, tx } = obs;
    let message;
    let ok = false;
    const stage = snap.ok ? snap.stageInfo.stage : null;
    if (!snap.ok) message = snap.problem;
    else if (!stage || stage.consequential !== kind) message = `There is no ${kind} to confirm on this page.`;
    else if (kind === KINDS.SUBMISSION && snap.page.counts.requiredEmpty > 0) message = `${snap.page.counts.requiredEmpty} required field(s) are still empty. Fill them in first.`;
    else if (snap.page.errors.length) message = 'The page is showing an error. Fix it before confirming.';
    else {
      const res = tx.tm.confirm(kind);
      ok = res.ok;
      message = res.ok ? `${kind === KINDS.PAYMENT ? 'Payment' : 'Submission'} confirmed. Now press "${kind === KINDS.PAYMENT ? 'Pay now' : 'Submit application now'}" to send it. The confirmation expires in 2 minutes.` : res.reason;
    }
    await saveTx(tx);
    return { ok, message, view: buildView(obs) };
  }

  async function opExecute(kind) {
    // Re-read the page first: any change since confirming invalidates the confirmation inside authoriseExecution.
    const obs = await observe();
    const { snap, tx } = obs;
    const fail = async (message) => {
      await saveTx(tx);
      return { ok: false, message, view: buildView(obs) };
    };
    if (!snap.ok) return fail(snap.problem);
    const stage = snap.stageInfo.stage;
    if (!stage || stage.consequential !== kind) return fail(`There is no ${kind} to send on this page.`);
    const auth = tx.tm.authoriseExecution(kind);
    if (!auth.ok) return fail(auth.reason);
    const targets = snap.page.actions.filter((a) => a.consequentialKind === kind && !a.disabled);
    if (targets.length !== 1) {
      tx.tm.markFailed(kind, `I could not find exactly one ${kind} button on the page. Use the site's own button yourself.`);
      return fail(`I could not find exactly one ${kind} button on the page. Use the site's own button yourself.`);
    }
    const res = await bridge.send(MSG.CLICK, { actionId: targets[0].id, grant: auth.grant });
    // A navigation can close the message channel after the click happened; treat that as activated.
    if (res?.ok || res?.navigated) {
      tx.tm.markActivated(kind);
      await saveTx(tx);
      return { ok: true, message: `${kind === KINDS.PAYMENT ? 'Payment' : 'Submission'} sent to the site. Waiting for its response.`, view: buildView(obs) };
    }
    tx.tm.markFailed(kind, 'The page did not accept the action. Confirm again to retry.');
    return fail('The page did not accept the action. Nothing was sent.');
  }

  async function opCancel() {
    const obs = await observe();
    obs.tx.tm.cancel();
    await saveTx(obs.tx);
    return { ok: true, message: 'Review cancelled. It will reappear if you stay on this step.', view: buildView({ ...obs, blockedReason: null }) };
  }

  async function opSetPrefs(partial) {
    const prefs = await provider.saveProfile(partial);
    const obs = await observe();
    return { ok: true, prefs, view: buildView(obs) };
  }

  async function opReset() {
    await saveWorkflowState(local, { workflowId: null, stageId: null, furthestIndex: -1, updatedAt: 0 });
    await session.remove(TX_KEY);
    const obs = await observe();
    return { ok: true, message: 'Progress and any pending confirmation were cleared.', view: buildView(obs) };
  }

  async function opStatus() {
    return { ok: true, status: { ...(await provider.getStatus()), worker: 'running' } };
  }

  // ---- message entry point -----------------------------------------------------------------------

  async function handle(msg, sender) {
    const checked = validateMessage(msg, sender, ids);
    if (!checked.ok) return { ok: false, error: checked.error };
    const { type, payload } = checked;
    try {
      switch (type) {
        case MSG.GET_VIEW: return await serialise(() => opGetView());
        case MSG.COMMAND: return await serialise(() => opCommand(payload.text));
        case MSG.GET_STATUS: return await opStatus();
        case MSG.SET_PREFS: return await serialise(() => opSetPrefs(payload.prefs));
        case MSG.CONFIRM: return await serialise(() => opConfirm(payload.kind));
        case MSG.EXECUTE: return await serialise(() => opExecute(payload.kind));
        case MSG.CANCEL_TX: return await serialise(() => opCancel());
        case MSG.RESET: return await serialise(() => opReset());
        case MSG.PAGE_EVENT:
          await serialise(() => observe());
          notifyPanel();
          return { ok: true };
        default:
          return { ok: false, error: 'Rejected: nothing handles this message.' };
      }
    } catch {
      return { ok: false, error: 'Something went wrong. Nothing was sent. Try again.' };
    }
  }

  return { handle, engine };
}
