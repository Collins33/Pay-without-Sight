// Deterministic confirmation gate: issues, validates, expires, consumes and invalidates one confirmation token.

export const DEFAULT_TTL_MS = 120_000;

function defaultRandomToken() {
  const c = globalThis.crypto;
  if (!c?.getRandomValues) throw new Error('No secure random source available');
  const bytes = new Uint8Array(16);
  c.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export class ConfirmationGate {
  /**
   * @param {{now?:()=>number, randomToken?:()=>string, ttlMs?:number}} [opts]
   */
  constructor({ now = () => Date.now(), randomToken = defaultRandomToken, ttlMs = DEFAULT_TTL_MS } = {}) {
    this.now = now;
    this.randomToken = randomToken;
    this.ttlMs = ttlMs;
    /** @type {null|{token:string, kind:string, detailsKey:string, issuedAt:number, expiresAt:number, used:boolean, invalidated:string|null}} */
    this.record = null;
  }

  /** Issues a new token bound to a kind and the exact transaction details. Replaces any earlier token. */
  issue({ kind, detailsKey }) {
    if (!kind || typeof kind !== 'string') throw new Error('kind is required');
    if (!detailsKey || typeof detailsKey !== 'string') throw new Error('detailsKey is required');
    const issuedAt = this.now();
    this.record = { token: this.randomToken(), kind, detailsKey, issuedAt, expiresAt: issuedAt + this.ttlMs, used: false, invalidated: null };
    return { token: this.record.token, expiresAt: this.record.expiresAt };
  }

  /** Checks a token without consuming it. Returns {valid, reason}. */
  validate({ token, kind, detailsKey }) {
    const r = this.record;
    if (!r || typeof token !== 'string' || token === '' || token !== r.token) return { valid: false, reason: 'no_confirmation' };
    if (r.invalidated) return { valid: false, reason: 'invalidated' };
    if (r.used) return { valid: false, reason: 'already_used' };
    if (this.now() >= r.expiresAt) return { valid: false, reason: 'expired' };
    if (kind !== r.kind) return { valid: false, reason: 'kind_mismatch' };
    if (detailsKey !== r.detailsKey) return { valid: false, reason: 'details_changed' };
    return { valid: true, reason: null };
  }

  /** Validates and, only if valid, marks the token as used so it cannot run twice. */
  consume(args) {
    const result = this.validate(args);
    if (result.valid) this.record.used = true;
    return result;
  }

  /** Invalidates the current token (for example because a detail changed). */
  invalidate(reason = 'invalidated') {
    if (this.record && !this.record.invalidated) this.record.invalidated = String(reason);
  }

  clear() {
    this.record = null;
  }

  /** Safe description of the current token. Never includes the token itself. */
  current() {
    const r = this.record;
    if (!r) return null;
    return { kind: r.kind, issuedAt: r.issuedAt, expiresAt: r.expiresAt, used: r.used, invalidated: r.invalidated, expired: this.now() >= r.expiresAt };
  }

  /** Returns the token string for the holder (the transaction manager) that needs to present it. */
  peekToken() {
    return this.record && !this.record.invalidated ? this.record.token : null;
  }

  serialize() {
    return this.record ? { ...this.record } : null;
  }

  hydrate(data) {
    if (!data || typeof data !== 'object') {
      this.record = null;
      return;
    }
    const ok = typeof data.token === 'string' && typeof data.kind === 'string' && typeof data.detailsKey === 'string' &&
      Number.isFinite(data.issuedAt) && Number.isFinite(data.expiresAt);
    this.record = ok
      ? { token: data.token, kind: data.kind, detailsKey: data.detailsKey, issuedAt: data.issuedAt, expiresAt: data.expiresAt, used: !!data.used, invalidated: data.invalidated ? String(data.invalidated) : null }
      : null;
  }
}
