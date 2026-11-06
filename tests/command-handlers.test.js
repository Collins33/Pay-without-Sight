// Unit tests for command handlers: wording, never revealing values, and the consequential-command rules.
import { describe, it, expect, vi } from 'vitest';
import { runCommand, describeField, NEED_ACCESS } from '../src/commands/command-handlers.js';
import { parseCommand } from '../src/commands/command-parser.js';
import { WorkflowEngine } from '../src/workflow/workflow-engine.js';
import { DEMO_WORKFLOW } from '../src/demo/demo-workflow.js';

const engine = new WorkflowEngine(DEMO_WORKFLOW);
const field = (id, name, extra = {}) => ({ id, name, nameSource: 'label', description: '', type: 'text', required: false, filled: false, sensitive: false, sensitiveCategory: null, invalid: false, errorText: '', disabled: false, ...extra });

function makeCtx({ href = 'http://localhost:4173/personal.html', fields, actions = [], errors = [], prefs = {}, extra = {} } = {}) {
  const fs = fields ?? [
    field('f1', 'Full name', { required: true, filled: true }),
    field('f2', 'Phone number', { required: true, type: 'tel', description: 'Include the country code.' }),
    field('f3', 'Verification code', { required: true, sensitive: true, sensitiveCategory: 'otp', filled: null }),
  ];
  const empty = fs.filter((f) => f.filled === false);
  const page = {
    title: 'Step 1 of 5: Personal details', fields: fs, actions, errors, focusedId: null,
    counts: {
      fields: fs.length, required: fs.filter((f) => f.required).length, empty: empty.length, requiredEmpty: empty.filter((f) => f.required).length,
      sensitive: fs.filter((f) => f.sensitive).length, requiredSensitive: fs.filter((f) => f.sensitive && f.required).length, errors: errors.length,
    },
  };
  return {
    page, stageInfo: engine.identify(href), prefs: { verbosity: 'normal', readBackEnabled: false, textSize: 'normal', ...prefs }, engine, workflow: DEMO_WORKFLOW,
    focusControl: vi.fn(async () => ({ ok: true })),
    clickAction: vi.fn(async () => ({ ok: true })),
    readBackValue: vi.fn(async () => ({ ok: true, value: 'Alice' })),
    readText: vi.fn(async () => ({ ok: true, text: 'Receipt number DEMO-1' })),
    beginTransaction: vi.fn(async () => ({ ok: true })),
    rememberReadBack: vi.fn(),
    ...extra,
  };
}
const run = (text, ctx) => runCommand(parseCommand(text), ctx);

describe('where am I', () => {
  it('reports title, stage, counts and errors', async () => {
    const r = await run('where am i', makeCtx());
    expect(r.message).toContain('Personal details');
    expect(r.message).toContain('step 1 of 5');
    expect(r.message).toContain('3 fields, 3 required, 1 empty (1 of them required)');
    expect(r.message).toContain('1 sensitive field not checked');
    expect(r.message).toContain('No errors showing');
  });

  it('says unknown page on other sites', async () => {
    const r = await run('where am i', makeCtx({ href: 'https://example.org/form' }));
    expect(r.message).toContain('unknown page');
  });

  it('reports the first error', async () => {
    const r = await run('where am i', makeCtx({ errors: [{ text: 'Phone is wrong', fieldId: 'f2' }] }));
    expect(r.message).toContain('1 error showing. First: Phone is wrong');
  });

  it('minimal verbosity is shorter', async () => {
    const normal = await run('where am i', makeCtx());
    const minimal = await run('where am i', makeCtx({ prefs: { verbosity: 'minimal' } }));
    expect(minimal.message.length).toBeLessThan(normal.message.length);
  });
});

describe('list fields', () => {
  it('lists every field with state and never a value', async () => {
    const r = await run('list fields', makeCtx());
    expect(r.lines[0]).toBe('1. Full name, text, required, filled.');
    expect(r.lines[1]).toContain('Phone number, phone number, required, empty.');
    expect(r.lines[2]).toContain('sensitive one-time code, I do not check or read it');
    expect(JSON.stringify(r)).not.toMatch(/value/i);
  });

  it('adds a buttons line marking consequential ones', async () => {
    const r = await run('list fields', makeCtx({ actions: [{ id: 'a1', name: 'Continue', consequentialKind: null }, { id: 'a2', name: 'Pay now', consequentialKind: 'payment' }] }));
    expect(r.lines.at(-1)).toBe('Buttons: Continue; Pay now (needs your confirmation).');
  });
});

describe('go to and next', () => {
  it('focuses the best match and announces it', async () => {
    const ctx = makeCtx();
    const r = await run('go to phone', ctx);
    expect(ctx.focusControl).toHaveBeenCalledWith('f2');
    expect(r.message).toContain('Phone number');
    expect(r.message).toContain('Include the country code.');
  });

  it('lists the options when ambiguous and does not move focus', async () => {
    const ctx = makeCtx({ fields: [field('a', 'Date of birth: Day'), field('b', 'Date of birth: Month')] });
    const r = await run('go to date of birth', ctx);
    expect(ctx.focusControl).not.toHaveBeenCalled();
    expect(r.lines).toEqual(['Date of birth: Day', 'Date of birth: Month']);
  });

  it('reports no match', async () => {
    expect((await run('go to banana', makeCtx())).message).toContain("couldn't find");
  });

  it('warns when focusing a consequential button but only moves focus', async () => {
    const ctx = makeCtx({ actions: [{ id: 'a1', name: 'Pay now', consequentialKind: 'payment' }] });
    const r = await run('go to pay now', ctx);
    expect(ctx.focusControl).toHaveBeenCalledWith('a1');
    expect(ctx.clickAction).not.toHaveBeenCalled();
    expect(r.message).toContain('pressing it is your decision');
  });

  it('next goes to the next unfilled required field', async () => {
    const ctx = makeCtx();
    const r = await run('next', ctx);
    expect(ctx.focusControl).toHaveBeenCalledWith('f2');
    expect(r.message).toContain('Next required field: Phone number');
  });

  it('next explains it cannot check a sensitive field', async () => {
    const ctx = makeCtx({ fields: [field('s', 'Verification code', { required: true, sensitive: true, sensitiveCategory: 'otp', filled: null })] });
    const r = await run('next', ctx);
    expect(r.message).toContain('I cannot tell whether it is filled');
  });
});

describe('explain, help, unknown, continue', () => {
  it('explains the stage', async () => {
    expect((await run('explain this stage', makeCtx())).message).toContain('full name, national ID number');
    expect((await run('explain this stage', makeCtx({ href: 'https://example.org/' }))).message).toContain('not one of the guided steps');
  });

  it('help lists commands even without a readable page', async () => {
    const r = await run('help', { ...makeCtx(), page: null });
    expect(r.lines.length).toBeGreaterThan(5);
  });

  it('unknown input gets the standard reply', async () => {
    expect((await run('banana', makeCtx())).message).toBe("I didn't understand that. Try: help.");
  });

  it('page commands explain how to grant access when the page cannot be read', async () => {
    const r = await run('where am i', { ...makeCtx(), page: null });
    expect(r.ok).toBe(false);
    expect(r.message).toBe(NEED_ACCESS);
  });

  it('continue presses only an ordinary forward button', async () => {
    const ctx = makeCtx({ actions: [{ id: 'a1', name: 'Pay now', consequentialKind: 'payment' }, { id: 'a2', name: 'Continue', consequentialKind: null }] });
    await run('continue', ctx);
    expect(ctx.clickAction).toHaveBeenCalledWith('a2');
  });

  it('continue never presses a consequential button', async () => {
    const ctx = makeCtx({ actions: [{ id: 'a1', name: 'Continue', consequentialKind: 'submission' }] });
    const r = await run('continue', ctx);
    expect(ctx.clickAction).not.toHaveBeenCalled();
    expect(r.ok).toBe(false);
  });
});

describe('submit and pay only open a review', () => {
  it('submit on the review step begins the review and asks for focus on it', async () => {
    const ctx = makeCtx({ href: 'http://localhost:4173/review.html' });
    const r = await run('submit', ctx);
    expect(ctx.beginTransaction).toHaveBeenCalledWith('submission');
    expect(ctx.clickAction).not.toHaveBeenCalled();
    expect(r.focusConfirm).toBe(true);
    expect(r.message).toContain('Nothing happens until you press "Confirm submission"');
  });

  it('pay on the payment step begins the payment review', async () => {
    const ctx = makeCtx({ href: 'http://localhost:4173/payment.html' });
    const r = await run('pay now', ctx);
    expect(ctx.beginTransaction).toHaveBeenCalledWith('payment');
    expect(ctx.clickAction).not.toHaveBeenCalled();
    expect(r.message).toContain('Confirm payment');
  });

  it('refuses on other steps and other sites, and never clicks', async () => {
    for (const href of ['http://localhost:4173/personal.html', 'https://shop.example/checkout']) {
      const ctx = makeCtx({ href });
      const r = await run('pay', ctx);
      expect(r.ok).toBe(false);
      expect(ctx.beginTransaction).not.toHaveBeenCalled();
      expect(ctx.clickAction).not.toHaveBeenCalled();
    }
  });

  it('wrong kind for the step is refused (submit on the payment step)', async () => {
    const ctx = makeCtx({ href: 'http://localhost:4173/payment.html' });
    expect((await run('submit', ctx)).ok).toBe(false);
    expect(ctx.beginTransaction).not.toHaveBeenCalled();
  });

  it('surfaces why a review could not open', async () => {
    const ctx = makeCtx({ href: 'http://localhost:4173/payment.html', extra: { beginTransaction: vi.fn(async () => ({ ok: false, reason: 'Complete the submission before the payment.' })) } });
    expect((await run('pay', ctx)).message).toBe('Complete the submission before the payment.');
  });
});

describe('read back', () => {
  it('is refused while the preference is off and never touches the page', async () => {
    const ctx = makeCtx();
    const r = await run('read back full name', ctx);
    expect(r.ok).toBe(false);
    expect(ctx.readBackValue).not.toHaveBeenCalled();
  });

  it('reads an ordinary field when enabled and remembers it for the review', async () => {
    const ctx = makeCtx({ prefs: { readBackEnabled: true } });
    const r = await run('read back full name', ctx);
    expect(r.message).toContain('Full name: Alice');
    expect(ctx.rememberReadBack).toHaveBeenCalledWith('Full name', 'Alice');
  });

  it('refuses sensitive fields even when enabled, without asking the page', async () => {
    const ctx = makeCtx({ prefs: { readBackEnabled: true } });
    const r = await run('read back verification code', ctx);
    expect(r.ok).toBe(false);
    expect(r.message).toContain('sensitive');
    expect(ctx.readBackValue).not.toHaveBeenCalled();
  });
});

describe('read receipt', () => {
  it('reads the receipt only on the receipt step', async () => {
    const ok = await run('read receipt', makeCtx({ href: 'http://localhost:4173/receipt.html' }));
    expect(ok.message).toContain('Receipt number DEMO-1');
    expect((await run('read receipt', makeCtx())).ok).toBe(false);
  });
});

describe('describeField', () => {
  it('includes error text and never a value', () => {
    expect(describeField(field('x', 'Phone', { required: true, invalid: true, errorText: 'Bad format' }))).toBe('Phone, text, required, empty. Error: Bad format');
  });
});
