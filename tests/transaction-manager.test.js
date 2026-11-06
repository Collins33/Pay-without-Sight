// Unit tests for the transaction manager: review, confirm, invalidation, gated execution, prerequisites.
import { describe, it, expect } from 'vitest';
import { TransactionManager, canonicalise, hashDetails, parseMoneyToMinor, validatePaymentDetails } from '../src/safety/transaction-manager.js';
import { ConfirmationGate } from '../src/safety/confirmation-gate.js';

const PAY = { recipient: 'Demo Authority', amount: 'KES 2,500.00', fees: 'KES 50.00', total: 'KES 2,550.00', purpose: 'Permit renewal' };
const SUB = { stage: 'review', fingerprint: 'abc123' };

function make(prereq = { payment: ['submission'] }) {
  const clock = { t: 1000 };
  let n = 0;
  const gate = new ConfirmationGate({ now: () => clock.t, randomToken: () => `tok-${++n}-xxxxxxxx`, ttlMs: 5000 });
  const tm = new TransactionManager({ gate, now: () => clock.t, prerequisites: prereq });
  return { tm, clock };
}

describe('helpers', () => {
  it('parses money to minor units', () => {
    expect(parseMoneyToMinor('KES 2,550.00')).toBe(255000);
    expect(parseMoneyToMinor('50')).toBe(5000);
    expect(parseMoneyToMinor('USD 1.5')).toBe(150);
    expect(parseMoneyToMinor('free')).toBeNull();
  });
  it('canonicalise is order independent and hashDetails is stable', () => {
    expect(canonicalise({ a: '1', b: '2' })).toBe(canonicalise({ b: '2', a: '1' }));
    expect(hashDetails({ a: '1' })).toBe(hashDetails({ a: '1' }));
    expect(hashDetails({ a: '1' })).not.toBe(hashDetails({ a: '2' }));
  });
  it('validates payment totals', () => {
    expect(validatePaymentDetails(PAY).ok).toBe(true);
    expect(validatePaymentDetails({ ...PAY, total: 'KES 9,999.00' }).ok).toBe(false);
    expect(validatePaymentDetails({ ...PAY, recipient: '' }).ok).toBe(false);
  });
});

describe('TransactionManager submission', () => {
  it('cannot execute without confirmation', () => {
    const { tm } = make();
    tm.begin('submission', SUB, []);
    expect(tm.authoriseExecution('submission').ok).toBe(false);
  });

  it('confirm then execute succeeds once and marks completed', () => {
    const { tm } = make();
    tm.begin('submission', SUB, []);
    expect(tm.confirm('submission').ok).toBe(true);
    const auth = tm.authoriseExecution('submission');
    expect(auth.ok).toBe(true);
    expect(auth.grant.kind).toBe('submission');
    tm.markExecuted('submission');
    expect(tm.getView().completed.submission).toBe(true);
    expect(tm.authoriseExecution('submission').ok).toBe(false);
  });

  it('a changed detail after confirming invalidates the confirmation and says so', () => {
    const { tm } = make();
    tm.begin('submission', SUB, []);
    tm.confirm('submission');
    const res = tm.update('submission', { ...SUB, fingerprint: 'zzz999' });
    expect(res.changed).toBe(true);
    const view = tm.getView().pending;
    expect(view.status).toBe('awaiting_confirmation');
    expect(view.notice.type).toBe('invalidated');
    expect(tm.authoriseExecution('submission').ok).toBe(false);
  });

  it('an unchanged update keeps the confirmation', () => {
    const { tm } = make();
    tm.begin('submission', SUB, []);
    tm.confirm('submission');
    tm.update('submission', { ...SUB });
    expect(tm.getView().pending.status).toBe('confirmed');
  });

  it('the confirmation expires', () => {
    const { tm, clock } = make();
    tm.begin('submission', SUB, []);
    tm.confirm('submission');
    clock.t += 6000;
    expect(tm.authoriseExecution('submission').ok).toBe(false);
    expect(tm.getView().pending.status).toBe('awaiting_confirmation');
  });

  it('a failed run requires fresh confirmation', () => {
    const { tm } = make();
    tm.begin('submission', SUB, []);
    tm.confirm('submission');
    tm.authoriseExecution('submission');
    tm.markFailed('submission', 'button not found');
    expect(tm.getView().pending.status).toBe('awaiting_confirmation');
    expect(tm.authoriseExecution('submission').ok).toBe(false);
  });
});

describe('TransactionManager payment', () => {
  function submitted() {
    const ctx = make();
    ctx.tm.begin('submission', SUB, []);
    ctx.tm.confirm('submission');
    ctx.tm.authoriseExecution('submission');
    ctx.tm.markExecuted('submission');
    ctx.tm.clearPending();
    return ctx;
  }

  it('payment cannot begin before the submission is completed', () => {
    const { tm } = make();
    const r = tm.begin('payment', PAY, []);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/submission/);
  });

  it('a submission confirmation never authorises a payment', () => {
    const { tm } = submitted();
    tm.begin('payment', PAY, []);
    expect(tm.authoriseExecution('payment').ok).toBe(false);
  });

  it('requires a separate payment confirmation', () => {
    const { tm } = submitted();
    expect(tm.begin('payment', PAY, []).ok).toBe(true);
    expect(tm.confirm('payment').ok).toBe(true);
    expect(tm.authoriseExecution('payment').ok).toBe(true);
  });

  it('changing the amount after confirming invalidates it', () => {
    const { tm } = submitted();
    tm.begin('payment', PAY, []);
    tm.confirm('payment');
    tm.update('payment', { ...PAY, amount: 'KES 2,600.00', total: 'KES 2,650.00' });
    expect(tm.getView().pending.notice.type).toBe('invalidated');
    expect(tm.authoriseExecution('payment').ok).toBe(false);
  });

  it('inconsistent totals block confirmation', () => {
    const { tm } = submitted();
    expect(tm.begin('payment', { ...PAY, total: 'KES 1.00' }, []).ok).toBe(false);
  });

  it('inconsistent totals after confirming invalidate it', () => {
    const { tm } = submitted();
    tm.begin('payment', PAY, []);
    tm.confirm('payment');
    expect(tm.update('payment', { ...PAY, total: 'KES 1.00' }).ok).toBe(false);
    expect(tm.authoriseExecution('payment').ok).toBe(false);
  });
});

describe('persistence', () => {
  it('state and confirmation survive serialise/hydrate', () => {
    const { tm, clock } = make();
    tm.begin('submission', SUB, [{ label: 'x', value: 'y' }]);
    tm.confirm('submission');
    const data = JSON.parse(JSON.stringify(tm.serialize()));
    const gate = new ConfirmationGate({ now: () => clock.t, ttlMs: 5000 });
    const tm2 = new TransactionManager({ gate, now: () => clock.t, prerequisites: { payment: ['submission'] } });
    tm2.hydrate(data);
    expect(tm2.getView().pending.status).toBe('confirmed');
    expect(tm2.authoriseExecution('submission').ok).toBe(true);
  });

  it('an in-flight executing state is not resumed after restart', () => {
    const { tm } = make();
    tm.begin('submission', SUB, []);
    tm.confirm('submission');
    tm.authoriseExecution('submission');
    const tm2 = make().tm;
    tm2.hydrate(JSON.parse(JSON.stringify(tm.serialize())));
    expect(tm2.getView().pending.status).toBe('awaiting_confirmation');
    expect(tm2.authoriseExecution('submission').ok).toBe(false);
  });

  it('view never contains the token', () => {
    const { tm } = make();
    tm.begin('submission', SUB, []);
    tm.confirm('submission');
    expect(JSON.stringify(tm.getView())).not.toMatch(/tok-1/);
  });
});
