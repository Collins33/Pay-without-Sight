// Unit tests for label matching and next-field selection.
import { describe, it, expect } from 'vitest';
import { matchControls, pickNextField, scoreName } from '../src/commands/field-matcher.js';

const f = (id, name, extra = {}) => ({ id, name, required: false, filled: false, invalid: false, sensitive: false, disabled: false, ...extra });
const fields = [
  f('f1', 'Full name', { required: true }),
  f('f2', 'National ID number', { required: true }),
  f('f3', 'Phone number', { required: true }),
  f('f4', 'Date of birth: Day', { required: true }),
  f('f5', 'Date of birth: Month', { required: true }),
  f('f6', 'Date of birth: Year', { required: true }),
];
const actions = [{ id: 'a1', name: 'Continue' }];

describe('matchControls', () => {
  it('matches exact, prefix and word-contained names', () => {
    expect(matchControls(fields, actions, 'full name')).toMatchObject({ status: 'match', item: { id: 'f1' } });
    expect(matchControls(fields, actions, 'phone')).toMatchObject({ status: 'match', item: { id: 'f3' } });
    expect(matchControls(fields, actions, 'the national id field')).toMatchObject({ status: 'match', item: { id: 'f2' } });
    expect(matchControls(fields, actions, 'date of birth day')).toMatchObject({ status: 'match', item: { id: 'f4' } });
    expect(matchControls(fields, actions, 'day')).toMatchObject({ status: 'match', item: { id: 'f4' } });
  });

  it('asks when several match equally', () => {
    const r = matchControls(fields, actions, 'date of birth');
    expect(r.status).toBe('ambiguous');
    expect(r.options.map((o) => o.id)).toEqual(['f4', 'f5', 'f6']);
    expect(matchControls(fields, actions, 'number').status).toBe('ambiguous');
  });

  it('can match buttons and reports no match', () => {
    expect(matchControls(fields, actions, 'continue')).toMatchObject({ status: 'match', kind: 'action' });
    expect(matchControls(fields, actions, 'banana')).toEqual({ status: 'none' });
    expect(matchControls(fields, actions, '')).toEqual({ status: 'none' });
  });

  it('prefers a more exact match over a looser one', () => {
    const fs = [f('a', 'Name'), f('b', 'Full name')];
    expect(matchControls(fs, [], 'name')).toMatchObject({ item: { id: 'a' } });
  });

  it('scoreName tiers', () => {
    expect(scoreName('Full name', 'full name')).toBe(100);
    expect(scoreName('Full name', 'full')).toBe(80);
    expect(scoreName('Full name', 'name')).toBe(60);
    expect(scoreName('Full name', 'banana')).toBe(0);
  });
});

describe('pickNextField', () => {
  it('returns the first empty required field when nothing is focused', () => {
    expect(pickNextField(fields, null)).toMatchObject({ field: { id: 'f1' }, reason: 'empty-required' });
  });

  it('moves on from the focused field and skips filled ones', () => {
    const fs = fields.map((x) => (x.id === 'f2' ? { ...x, filled: true } : x));
    expect(pickNextField(fs, 'f1').field.id).toBe('f3');
  });

  it('wraps around', () => {
    const fs = fields.map((x) => (x.id === 'f1' ? x : { ...x, filled: true }));
    expect(pickNextField(fs, 'f4').field.id).toBe('f1');
  });

  it('falls back to fields with errors, then required sensitive fields', () => {
    const allFilled = fields.map((x) => ({ ...x, filled: true }));
    expect(pickNextField(allFilled.map((x) => (x.id === 'f3' ? { ...x, invalid: true } : x)), null)).toMatchObject({ field: { id: 'f3' }, reason: 'invalid' });
    const withSensitive = [...allFilled, f('s1', 'Verification code', { required: true, sensitive: true, filled: null })];
    expect(pickNextField(withSensitive, null)).toMatchObject({ field: { id: 's1' }, reason: 'sensitive-required' });
  });

  it('returns null when nothing needs attention or there are no fields', () => {
    expect(pickNextField(fields.map((x) => ({ ...x, filled: true })), null)).toBeNull();
    expect(pickNextField([], null)).toBeNull();
  });

  it('does not treat an optional empty field as needing attention', () => {
    expect(pickNextField([f('x', 'Nickname')], null)).toBeNull();
  });
});
