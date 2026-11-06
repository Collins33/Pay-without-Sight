// Tracks one pending submission or payment, binds confirmations to exact details, and gates execution.
import { ConfirmationGate } from './confirmation-gate.js';

export const ACTIVATION_TIMEOUT_MS = 20_000;
export const KINDS = Object.freeze({ SUBMISSION: 'submission', PAYMENT: 'payment' });

/** Stable string for a details object: keys sorted, values stringified. */
export function canonicalise(details) {
  const keys = Object.keys(details ?? {}).sort();
  return JSON.stringify(keys.map((k) => [k, typeof details[k] === 'string' ? details[k] : JSON.stringify(details[k])]));
}

/** Short non-secret identifier for display and logs (FNV-1a, 32 bit). Not a security boundary. */
export function hashDetails(details) {
  let h = 0x811c9dc5;
  const s = canonicalise(details);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** Parses a displayed money string such as "KES 2,550.00" into integer minor units, or null. */
export function parseMoneyToMinor(text) {
  const m = /(-?\d[\d,]*)(?:\.(\d{1,2}))?/.exec(String(text ?? ''));
  if (!m) return null;
  const whole = Number(m[1].replace(/,/g, ''));
  const frac = Number((m[2] ?? '').padEnd(2, '0') || 0);
  if (!Number.isFinite(whole)) return null;
  return whole * 100 + frac;
}

/** Checks payment details are present and that amount + fees equals total. */
export function validatePaymentDetails(d) {
  for (const key of ['recipient', 'amount', 'fees', 'total', 'purpose']) {
    if (typeof d?.[key] !== 'string' || d[key].trim() === '') return { ok: false, reason: `Payment detail "${key}" could not be read from the page.` };
  }
  const amount = parseMoneyToMinor(d.amount);
  const fees = parseMoneyToMinor(d.fees);
  const total = parseMoneyToMinor(d.total);
  if (amount === null || fees === null || total === null) return { ok: false, reason: 'Payment amounts could not be read as numbers.' };
  if (amount + fees !== total) return { ok: false, reason: 'The total does not equal the amount plus fees, so I will not offer confirmation.' };
  return { ok: true };
}

const INITIAL = () => ({ pending: null, completed: { submission: false, payment: false } });

export class TransactionManager {
  /**
   * @param {{gate?:ConfirmationGate, now?:()=>number, prerequisites?:Record<string,string[]>}} [opts]
   */
  constructor({ gate, now = () => Date.now(), prerequisites = {} } = {}) {
    this.now = now;
    this.gate = gate ?? new ConfirmationGate({ now });
    this.prerequisites = prerequisites;
    this.state = INITIAL();
  }

  /** Shows a transaction for review. This never authorises anything. */
  begin(kind, details, lines = []) {
    if (!Object.values(KINDS).includes(kind)) return { ok: false, reason: 'Unknown transaction kind.' };
    if (this.state.completed[kind]) return { ok: false, reason: `The ${kind} was already completed.` };
    for (const needed of this.prerequisites[kind] ?? []) {
      if (!this.state.completed[needed]) return { ok: false, reason: `Complete the ${needed} before the ${kind}.` };
    }
    if (kind === KINDS.PAYMENT) {
      const check = validatePaymentDetails(details);
      if (!check.ok) return check;
    }
    const prev = this.state.pending;
    if (prev && prev.kind === kind) return this.update(kind, details, lines);
    this.gate.clear();
    this.state.pending = { kind, status: 'awaiting_confirmation', details: { ...details }, detailsKey: canonicalise(details), lines, notice: null, expiresAt: null };
    return { ok: true };
  }

  /** Called whenever the page is re-read. Any change after confirmation invalidates the token. */
  update(kind, details, lines = null) {
    const p = this.state.pending;
    if (!p || p.kind !== kind) return { ok: false, reason: 'No such transaction is pending.' };
    this._checkActivation(p);
    if (['executing', 'activated', 'executed'].includes(p.status)) return { ok: true, changed: false };
    const key = canonicalise(details);
    if (kind === KINDS.PAYMENT) {
      const check = validatePaymentDetails(details);
      if (!check.ok) {
        this._invalidateConfirmation(p, check.reason);
        return check;
      }
    }
    const changed = key !== p.detailsKey;
    if (changed) {
      if (p.status === 'confirmed') this._invalidateConfirmation(p, 'A detail changed after you confirmed. The confirmation is no longer valid. Review and confirm again.');
      p.details = { ...details };
      p.detailsKey = key;
    }
    if (lines) p.lines = lines;
    if (p.status === 'confirmed' && this.now() >= (p.expiresAt ?? 0)) this._invalidateConfirmation(p, 'The confirmation expired. Confirm again.');
    return { ok: true, changed };
  }

  /** The user's explicit confirmation. Issues a token bound to the current details. */
  confirm(kind) {
    const p = this.state.pending;
    if (!p || p.kind !== kind) return { ok: false, reason: 'Nothing of that kind is waiting for confirmation.' };
    if (['executing', 'activated', 'executed'].includes(p.status)) return { ok: false, reason: 'This has already been sent.' };
    if (kind === KINDS.PAYMENT) {
      const check = validatePaymentDetails(p.details);
      if (!check.ok) return check;
    }
    const { expiresAt } = this.gate.issue({ kind, detailsKey: p.detailsKey });
    p.status = 'confirmed';
    p.expiresAt = expiresAt;
    p.notice = null;
    return { ok: true, expiresAt };
  }

  /**
   * Asks permission to run the action now. Succeeds only with a valid, current, unexpired confirmation
   * for exactly these details. The token is consumed, so it cannot be replayed.
   */
  authoriseExecution(kind) {
    const p = this.state.pending;
    if (!p || p.kind !== kind) return { ok: false, reason: 'No confirmation exists for this action.' };
    const token = this.gate.peekToken();
    const result = this.gate.consume({ token, kind, detailsKey: p.detailsKey });
    if (!result.valid) {
      const messages = {
        no_confirmation: 'Not confirmed yet. Confirm first.',
        expired: 'The confirmation expired. Confirm again.',
        details_changed: 'Details changed since you confirmed. Confirm again.',
        invalidated: 'The confirmation is no longer valid. Confirm again.',
        already_used: 'This confirmation was already used.',
        kind_mismatch: 'That confirmation is for a different action.',
      };
      if (p.status === 'confirmed') {
        p.status = 'awaiting_confirmation';
        p.notice = { type: 'invalidated', text: messages[result.reason] ?? 'Confirm again.' };
      }
      return { ok: false, reason: messages[result.reason] ?? 'Not allowed.' };
    }
    p.status = 'executing';
    return { ok: true, grant: { kind, token, expiresAt: Math.min(p.expiresAt, this.now() + 15_000) } };
  }

  /** The page control was activated. This is not yet proof that the site accepted it. */
  markActivated(kind) {
    const p = this.state.pending;
    if (!p || p.kind !== kind) return;
    p.status = 'activated';
    p.activatedAt = this.now();
    this.gate.clear();
  }

  /** If the site has not answered after a while, return to needing a fresh confirmation (never auto-retries). */
  _checkActivation(p) {
    if (p.status === 'activated' && this.now() - (p.activatedAt ?? 0) > ACTIVATION_TIMEOUT_MS) {
      p.status = 'awaiting_confirmation';
      p.notice = { type: 'failed', text: 'The site did not respond. Check the page, then confirm again if needed.' };
    }
  }

  /** Called once the workflow has been observed moving past this step (or after an observed success). */
  markExecuted(kind) {
    const p = this.state.pending;
    if (p && p.kind === kind) p.status = 'executed';
    this.state.completed[kind] = true;
    this.gate.clear();
  }

  /** Records completion observed without our involvement (for example the user pressed the site's own button). */
  noteCompleted(kind) {
    this.state.completed[kind] = true;
  }

  markFailed(kind, reason) {
    const p = this.state.pending;
    if (!p || p.kind !== kind) return;
    p.status = 'awaiting_confirmation';
    p.notice = { type: 'failed', text: reason || 'The action did not run. Confirm again to retry.' };
    this.gate.clear();
  }

  cancel() {
    if (this.state.pending && !['executed', 'activated'].includes(this.state.pending.status)) {
      this.state.pending = null;
      this.gate.clear();
    }
  }

  clearPending() {
    this.state.pending = null;
    this.gate.clear();
  }

  reset() {
    this.state = INITIAL();
    this.gate.clear();
  }

  _invalidateConfirmation(p, text) {
    this.gate.invalidate('details_changed');
    this.gate.clear();
    if (p.status === 'confirmed' || p.status === 'awaiting_confirmation') {
      p.status = 'awaiting_confirmation';
      p.expiresAt = null;
      p.notice = { type: 'invalidated', text };
    }
  }

  /** Display model for the side panel. Never includes the token. */
  getView() {
    const p = this.state.pending;
    if (!p) return { pending: null, completed: { ...this.state.completed } };
    this._checkActivation(p);
    if (p.status === 'confirmed' && this.now() >= (p.expiresAt ?? 0)) this._invalidateConfirmation(p, 'The confirmation expired. Confirm again.');
    return {
      pending: { kind: p.kind, status: p.status, lines: p.lines, notice: p.notice, expiresAt: p.expiresAt, detailsId: hashDetails(p.details) },
      completed: { ...this.state.completed },
    };
  }

  serialize() {
    return { tx: JSON.parse(JSON.stringify(this.state)), gate: this.gate.serialize() };
  }

  hydrate(data) {
    const tx = data?.tx;
    this.state = INITIAL();
    if (tx && typeof tx === 'object') {
      this.state.completed = { submission: !!tx.completed?.submission, payment: !!tx.completed?.payment };
      const p = tx.pending;
      if (p && typeof p === 'object' && Object.values(KINDS).includes(p.kind) && typeof p.detailsKey === 'string') {
        // An in-flight "executing" state cannot be trusted after a restart: fall back to needing confirmation.
        const status = p.status === 'executing' ? 'awaiting_confirmation' : p.status;
        this.state.pending = { kind: p.kind, status, details: p.details ?? {}, detailsKey: p.detailsKey, lines: Array.isArray(p.lines) ? p.lines : [], notice: p.notice ?? null, expiresAt: p.expiresAt ?? null, activatedAt: p.activatedAt ?? 0 };
      }
    }
    this.gate.hydrate(data?.gate);
  }
}
