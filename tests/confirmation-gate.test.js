// Unit tests for the confirmation gate: issue, validate, expire, invalidate, single use, persistence.
import { describe, it, expect } from 'vitest';
import { ConfirmationGate } from '../src/safety/confirmation-gate.js';

function makeGate(ttlMs = 1000) {
  const clock = { t: 10_000 };
  let n = 0;
  const gate = new ConfirmationGate({ now: () => clock.t, randomToken: () => `token-${++n}-abcdefgh`, ttlMs });
  return { gate, clock };
}

describe('ConfirmationGate', () => {
  it('validates a freshly issued token for the same kind and details', () => {
    const { gate } = makeGate();
    const { token } = gate.issue({ kind: 'payment', detailsKey: 'A' });
    expect(gate.validate({ token, kind: 'payment', detailsKey: 'A' })).toEqual({ valid: true, reason: null });
  });

  it('no confirmation means no execution', () => {
    const { gate } = makeGate();
    expect(gate.validate({ token: 'anything', kind: 'payment', detailsKey: 'A' }).valid).toBe(false);
    expect(gate.consume({ token: undefined, kind: 'payment', detailsKey: 'A' }).reason).toBe('no_confirmation');
  });

  it('rejects a wrong or empty token', () => {
    const { gate } = makeGate();
    gate.issue({ kind: 'payment', detailsKey: 'A' });
    expect(gate.validate({ token: 'wrong', kind: 'payment', detailsKey: 'A' }).valid).toBe(false);
    expect(gate.validate({ token: '', kind: 'payment', detailsKey: 'A' }).valid).toBe(false);
  });

  it('expires after the ttl', () => {
    const { gate, clock } = makeGate(1000);
    const { token } = gate.issue({ kind: 'submission', detailsKey: 'A' });
    clock.t += 999;
    expect(gate.validate({ token, kind: 'submission', detailsKey: 'A' }).valid).toBe(true);
    clock.t += 1;
    expect(gate.validate({ token, kind: 'submission', detailsKey: 'A' })).toEqual({ valid: false, reason: 'expired' });
  });

  it('is invalid if any transaction detail changed', () => {
    const { gate } = makeGate();
    const { token } = gate.issue({ kind: 'payment', detailsKey: 'amount=100' });
    expect(gate.validate({ token, kind: 'payment', detailsKey: 'amount=101' })).toEqual({ valid: false, reason: 'details_changed' });
  });

  it('a submission token cannot authorise a payment', () => {
    const { gate } = makeGate();
    const { token } = gate.issue({ kind: 'submission', detailsKey: 'A' });
    expect(gate.validate({ token, kind: 'payment', detailsKey: 'A' })).toEqual({ valid: false, reason: 'kind_mismatch' });
  });

  it('can be invalidated explicitly', () => {
    const { gate } = makeGate();
    const { token } = gate.issue({ kind: 'payment', detailsKey: 'A' });
    gate.invalidate('details_changed');
    expect(gate.validate({ token, kind: 'payment', detailsKey: 'A' })).toEqual({ valid: false, reason: 'invalidated' });
    expect(gate.peekToken()).toBeNull();
  });

  it('consume works once only', () => {
    const { gate } = makeGate();
    const { token } = gate.issue({ kind: 'payment', detailsKey: 'A' });
    expect(gate.consume({ token, kind: 'payment', detailsKey: 'A' }).valid).toBe(true);
    expect(gate.consume({ token, kind: 'payment', detailsKey: 'A' })).toEqual({ valid: false, reason: 'already_used' });
  });

  it('a failed consume does not burn the token', () => {
    const { gate } = makeGate();
    const { token } = gate.issue({ kind: 'payment', detailsKey: 'A' });
    expect(gate.consume({ token, kind: 'payment', detailsKey: 'B' }).valid).toBe(false);
    expect(gate.consume({ token, kind: 'payment', detailsKey: 'A' }).valid).toBe(true);
  });

  it('issuing a new token replaces the old one', () => {
    const { gate } = makeGate();
    const first = gate.issue({ kind: 'payment', detailsKey: 'A' });
    const second = gate.issue({ kind: 'payment', detailsKey: 'A' });
    expect(gate.validate({ token: first.token, kind: 'payment', detailsKey: 'A' }).valid).toBe(false);
    expect(gate.validate({ token: second.token, kind: 'payment', detailsKey: 'A' }).valid).toBe(true);
  });

  it('current() never exposes the token', () => {
    const { gate } = makeGate();
    const { token } = gate.issue({ kind: 'payment', detailsKey: 'A' });
    expect(JSON.stringify(gate.current())).not.toContain(token);
  });

  it('survives serialise and hydrate (service worker restart)', () => {
    const { gate, clock } = makeGate();
    const { token } = gate.issue({ kind: 'payment', detailsKey: 'A' });
    const copy = new ConfirmationGate({ now: () => clock.t, ttlMs: 1000 });
    copy.hydrate(JSON.parse(JSON.stringify(gate.serialize())));
    expect(copy.validate({ token, kind: 'payment', detailsKey: 'A' }).valid).toBe(true);
  });

  it('ignores corrupted persisted data', () => {
    const { gate } = makeGate();
    gate.hydrate({ token: 5, kind: null });
    expect(gate.current()).toBeNull();
  });

  it('requires kind and detailsKey to issue', () => {
    const { gate } = makeGate();
    expect(() => gate.issue({ kind: '', detailsKey: 'A' })).toThrow();
    expect(() => gate.issue({ kind: 'payment', detailsKey: '' })).toThrow();
  });
});
