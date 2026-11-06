// Unit tests for the deterministic command grammar, including that vague wording never becomes a consequential action.
import { describe, it, expect } from 'vitest';
import { parseCommand } from '../src/commands/command-parser.js';

const cmd = (s) => parseCommand(s).command;

describe('parseCommand', () => {
  it('parses the core commands with tolerant casing and punctuation', () => {
    expect(cmd('where am I')).toBe('where_am_i');
    expect(cmd('  Where am I?  ')).toBe('where_am_i');
    expect(cmd('LIST FIELDS')).toBe('list_fields');
    expect(cmd('next')).toBe('next');
    expect(cmd('explain this stage')).toBe('explain');
    expect(cmd('help')).toBe('help');
    expect(cmd('?')).toBe('help');
    expect(cmd('continue')).toBe('continue');
    expect(cmd('read receipt')).toBe('read_receipt');
  });

  it('extracts the argument of go to', () => {
    expect(parseCommand('go to Full name')).toMatchObject({ command: 'go_to', arg: 'full name' });
    expect(parseCommand('Go to  date of birth day.')).toMatchObject({ command: 'go_to', arg: 'date of birth day' });
    expect(parseCommand('goto phone')).toMatchObject({ command: 'go_to', arg: 'phone' });
    expect(cmd('go to')).toBe('unknown');
  });

  it('extracts the argument of read back in both word orders', () => {
    expect(parseCommand('read back full name')).toMatchObject({ command: 'read_back', arg: 'full name' });
    expect(parseCommand('read full name back')).toMatchObject({ command: 'read_back', arg: 'full name' });
  });

  it('returns unknown for anything else', () => {
    for (const s of ['', '   ', 'dance', 'where', 'list', 'what is this']) expect(cmd(s)).toBe('unknown');
  });

  it('only exact phrases open a submission or payment review', () => {
    expect(cmd('submit')).toBe('submit');
    expect(cmd('submit application')).toBe('submit');
    expect(cmd('pay now')).toBe('pay');
    expect(cmd('make payment')).toBe('pay');
  });

  it('never guesses a consequential action from vague or extended wording', () => {
    for (const s of ['send it', 'just do it', 'go ahead and pay', 'pay 5000 to John', 'pay now please', 'yes submit', 'submit it all', 'finish', 'complete the payment',
      'confirm', 'confirm payment', 'confirm submission', 'approve', 'okay', 'yes', 'do it']) {
      expect(['submit', 'pay']).not.toContain(cmd(s));
    }
  });

  it('never parses confirmation phrases as commands (confirmation only exists as a panel control)', () => {
    for (const s of ['confirm', 'i confirm', 'confirm payment', 'confirm submission', 'yes confirm']) expect(cmd(s)).toBe('unknown');
  });

  it('copes with non-string input and very long input', () => {
    expect(cmd(undefined)).toBe('unknown');
    expect(cmd(null)).toBe('unknown');
    expect(cmd(42)).toBe('unknown');
    expect(cmd('x'.repeat(10000))).toBe('unknown');
  });
});
