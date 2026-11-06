// Side panel UI: renders the coordinator's view, sends commands, and manages focus and live announcements.
import { MSG, makeMessage, PROTOCOL_VERSION } from '../communication/message-contracts.js';
import { TEXT_SIZE_PX } from '../prefs/app-prefs.js';

const $ = (id) => document.getElementById(id);
const el = {
  service: $('service'), stage: $('stage'), progressText: $('progress-text'), progressBar: $('progress-bar'), progressFill: $('progress-fill'),
  instruction: $('instruction'), form: $('command-form'), command: $('command'), result: $('result'),
  review: $('review'), reviewHeading: $('review-heading'), reviewIntro: $('review-intro'), reviewLines: $('review-lines'),
  notice: $('review-notice'), noticeText: $('review-notice-text'), reviewStatus: $('review-status'),
  confirmBtn: $('confirm-btn'), executeBtn: $('execute-btn'), cancelBtn: $('cancel-btn'),
  settingsToggle: $('settings-toggle'), settingsBody: $('settings-body'), verbosity: $('verbosity'), textSize: $('text-size'),
  readBack: $('read-back'), resetBtn: $('reset-btn'), status: $('status-line'),
};

const state = { view: null, lastStageId: undefined, reviewKind: null, lastNotice: '', expiryTimer: null };

const KIND_WORDS = {
  submission: { name: 'submission', confirm: 'Confirm submission', execute: 'Submit application now', intro: 'This is exactly what will be submitted. Fields show only whether they are filled, never what they contain.' },
  payment: { name: 'payment', confirm: 'Confirm payment', execute: 'Pay now', intro: 'Check these payment details. This is a separate confirmation from the submission.' },
};

// ---- messaging ----------------------------------------------------------------------------------

async function send(type, payload) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await chrome.runtime.sendMessage(makeMessage(type, payload));
      if (res) return res;
    } catch { /* the worker may be waking up: retry once */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  return { ok: false, error: 'The extension is not responding. Close and reopen the panel.' };
}

// ---- announcements -------------------------------------------------------------------------------

function announce(message, { lines = null, error = false } = {}) {
  el.result.replaceChildren();
  el.result.classList.toggle('error', error);
  const p = document.createElement('p');
  if (error) {
    const strong = document.createElement('span');
    strong.className = 'error-text';
    strong.textContent = '⚠ Error: ';
    p.append(strong);
  }
  p.append(document.createTextNode(message));
  el.result.append(p);
  if (lines?.length) {
    const ul = document.createElement('ul');
    for (const line of lines) {
      const li = document.createElement('li');
      li.textContent = line;
      ul.append(li);
    }
    el.result.append(ul);
  }
}

// ---- rendering -----------------------------------------------------------------------------------

function renderReview(view) {
  const tx = view.transaction?.pending ?? null;
  if (!tx) {
    el.review.hidden = true;
    state.reviewKind = null;
    state.lastNotice = '';
    return;
  }
  const words = KIND_WORDS[tx.kind];
  const wasHidden = el.review.hidden || state.reviewKind !== tx.kind;
  el.review.hidden = false;
  el.reviewHeading.textContent = `Review and confirm ${words.name}`;
  el.reviewIntro.textContent = words.intro;
  el.reviewLines.replaceChildren();
  for (const line of tx.lines) {
    const dt = document.createElement('dt');
    dt.textContent = line.label;
    const dd = document.createElement('dd');
    dd.textContent = line.value || '(not found on the page)';
    el.reviewLines.append(dt, dd);
  }
  const notice = tx.notice?.text ?? '';
  el.notice.hidden = !notice;
  el.noticeText.textContent = notice;
  if (notice && notice !== state.lastNotice) announce(notice, { error: true });
  state.lastNotice = notice;

  el.confirmBtn.textContent = words.confirm;
  el.executeBtn.textContent = words.execute;
  const confirmed = tx.status === 'confirmed';
  const sent = tx.status === 'activated' || tx.status === 'executing' || tx.status === 'executed';
  el.confirmBtn.hidden = confirmed || sent;
  el.executeBtn.hidden = !confirmed;
  el.cancelBtn.hidden = sent;
  el.reviewStatus.textContent = confirmed
    ? `Confirmed. Press "${words.execute}" within 2 minutes. If anything on the page changes, you will need to confirm again.`
    : sent
      ? 'Sent to the site. Waiting for its response.'
      : `Not confirmed yet. Nothing will be sent until you press "${words.confirm}".`;

  // Move focus to the heading once, when the review first appears.
  if (wasHidden) {
    state.reviewKind = tx.kind;
    el.reviewHeading.focus();
  }

  clearTimeout(state.expiryTimer);
  if (confirmed && tx.expiresAt) {
    state.expiryTimer = setTimeout(refresh, Math.max(tx.expiresAt - Date.now(), 0) + 300);
  }
}

function render(view, { announceStage = false } = {}) {
  state.view = view;
  el.service.textContent = view.service;
  el.stage.textContent = view.stage ? view.stage.title : 'unknown page';
  el.progressText.textContent = view.progress.text;
  el.progressBar.setAttribute('aria-valuemax', String(Math.max(view.progress.total, 1)));
  el.progressBar.setAttribute('aria-valuenow', String(view.progress.step));
  el.progressBar.setAttribute('aria-valuetext', view.progress.text);
  el.progressFill.style.width = view.progress.total ? `${(view.progress.step / view.progress.total) * 100}%` : '0';

  const blocked = view.transaction?.blockedReason;
  el.instruction.textContent = blocked ? `${view.instruction} ${blocked}` : view.instruction;

  const px = TEXT_SIZE_PX[view.prefs.textSize] ?? TEXT_SIZE_PX.normal;
  document.documentElement.style.setProperty('--base-size', `${px}px`);
  el.verbosity.value = view.prefs.verbosity;
  el.textSize.value = view.prefs.textSize;
  el.readBack.checked = !!view.prefs.readBackEnabled;

  renderReview(view);

  // Announce stage changes only (not every refresh), so the panel does not compete with the screen reader.
  const stageId = view.stage?.id ?? null;
  if (announceStage && state.lastStageId !== undefined && stageId !== state.lastStageId && stageId) {
    announce(`${view.progress.text}: ${view.stage.title}. ${view.instruction}`);
  }
  state.lastStageId = stageId;
}

async function refresh(announceStage = true) {
  const res = await send(MSG.GET_VIEW, {});
  if (res.ok) render(res.view, { announceStage: announceStage === true });
  else announce(res.error || res.message || 'Could not refresh.', { error: true });
}

async function refreshStatus() {
  const res = await send(MSG.GET_STATUS, {});
  const version = chrome.runtime.getManifest().version;
  if (!res.ok) {
    el.status.textContent = `Version ${version}. Toolkit: unknown. Service worker: not responding.`;
    return;
  }
  const s = res.status;
  const toolkit = s.integrated ? `integrated (${s.mode} mode)` : `not integrated (${s.mode} mode)`;
  el.status.textContent = `Version ${version}. Toolkit: ${toolkit}. Service worker: ${s.worker}.`;
}

// ---- actions -------------------------------------------------------------------------------------

el.form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const text = el.command.value.trim();
  if (!text) {
    announce('Type a command first. Try: help.', { error: true });
    return;
  }
  el.command.value = '';
  el.form.setAttribute('aria-busy', 'true');
  const res = await send(MSG.COMMAND, { text });
  el.form.removeAttribute('aria-busy');
  if (res.view) render(res.view);
  announce(res.message ?? res.error ?? 'No result.', { lines: res.lines, error: res.ok === false });
  if (res.focusConfirm && !el.review.hidden) el.reviewHeading.focus();
  else el.command.focus(); // keep focus in the instruction box
});

el.confirmBtn.addEventListener('click', async () => {
  const kind = state.view?.transaction?.pending?.kind;
  if (!kind) return;
  const res = await send(MSG.CONFIRM, { kind });
  if (res.view) render(res.view);
  announce(res.message ?? res.error, { error: res.ok === false });
  if (res.ok && !el.executeBtn.hidden) el.executeBtn.focus();
  else el.reviewHeading.focus();
});

el.executeBtn.addEventListener('click', async () => {
  const kind = state.view?.transaction?.pending?.kind;
  if (!kind) return;
  const res = await send(MSG.EXECUTE, { kind });
  if (res.view) render(res.view);
  announce(res.message ?? res.error, { error: res.ok === false });
  if (!el.review.hidden) el.reviewHeading.focus();
  else el.command.focus();
});

el.cancelBtn.addEventListener('click', async () => {
  const res = await send(MSG.CANCEL_TX, {});
  if (res.view) render(res.view);
  announce(res.message ?? 'Review cancelled.');
  el.command.focus();
});

el.settingsToggle.addEventListener('click', () => {
  const open = el.settingsToggle.getAttribute('aria-expanded') !== 'true';
  el.settingsToggle.setAttribute('aria-expanded', String(open));
  el.settingsBody.hidden = !open;
});

async function savePref(partial, spoken) {
  const res = await send(MSG.SET_PREFS, { prefs: partial });
  if (res.view) render(res.view);
  announce(res.ok ? spoken : 'Could not save that setting.', { error: !res.ok });
}
el.verbosity.addEventListener('change', () => savePref({ verbosity: el.verbosity.value }, `Announcement detail: ${el.verbosity.value}.`));
el.textSize.addEventListener('change', () => savePref({ textSize: el.textSize.value }, `Instruction text size: ${el.textSize.selectedOptions[0].textContent}.`));
el.readBack.addEventListener('change', () => savePref({ readBackEnabled: el.readBack.checked }, el.readBack.checked ? 'Reading values back on request is on. Sensitive fields are never read.' : 'Reading values back is off.'));

el.resetBtn.addEventListener('click', async () => {
  const res = await send(MSG.RESET, {});
  if (res.view) render(res.view);
  announce(res.message ?? res.error, { error: res.ok === false });
});

// ---- live updates from the service worker --------------------------------------------------------

function connect() {
  try {
    const port = chrome.runtime.connect({ name: 'pws-panel' });
    port.onMessage.addListener((msg) => {
      if (msg && msg.v === PROTOCOL_VERSION && msg.type === MSG.VIEW_UPDATE) refresh(true);
    });
    port.onDisconnect.addListener(() => setTimeout(connect, 1000)); // the worker was suspended: reconnect
  } catch { /* extension context gone */ }
}

window.addEventListener('focus', () => refresh(false));

connect();
refresh(false).then(() => {
  refreshStatus();
  el.command.focus();
});
