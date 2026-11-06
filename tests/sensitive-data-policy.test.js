// Unit tests for the sensitive data policy: metadata-only classification.
import { describe, it, expect } from 'vitest';
import { classifySensitivity, normaliseMetadataText, describeCategory } from '../src/safety/sensitive-data-policy.js';

describe('classifySensitivity', () => {
  it('flags password inputs', () => {
    expect(classifySensitivity({ type: 'password' })).toMatchObject({ sensitive: true, category: 'password' });
  });

  it('flags autocomplete one-time-code and card codes', () => {
    expect(classifySensitivity({ type: 'text', autocomplete: 'one-time-code' })).toMatchObject({ sensitive: true, category: 'otp' });
    expect(classifySensitivity({ type: 'text', autocomplete: 'cc-csc' })).toMatchObject({ sensitive: true, category: 'card-security-code' });
    expect(classifySensitivity({ type: 'text', autocomplete: 'cc-number' })).toMatchObject({ sensitive: true, category: 'card-number' });
    expect(classifySensitivity({ type: 'text', autocomplete: 'section-a billing cc-csc' }).sensitive).toBe(true);
  });

  it('flags by label, name, id and aria text', () => {
    expect(classifySensitivity({ type: 'text', labelText: 'Verification code' }).category).toBe('otp');
    expect(classifySensitivity({ type: 'text', name: 'payment_pin' }).category).toBe('pin');
    expect(classifySensitivity({ type: 'text', id: 'mpesaPin' }).sensitive).toBe(true);
    expect(classifySensitivity({ type: 'text', ariaLabel: 'Card security code' }).category).toBe('card-security-code');
    expect(classifySensitivity({ type: 'tel', name: 'cvv' }).category).toBe('card-security-code');
    expect(classifySensitivity({ type: 'text', placeholder: 'Enter OTP' }).category).toBe('otp');
  });

  it('does not flag ordinary fields or look-alike words', () => {
    for (const meta of [
      { type: 'text', labelText: 'Full name' },
      { type: 'text', labelText: 'Shipping address' },
      { type: 'text', name: 'mapping' },
      { type: 'text', labelText: 'Spinning class' },
      { type: 'email', autocomplete: 'email' },
      { type: 'text', labelText: 'National ID number' },
      { type: 'text', labelText: 'Pan-African trade code' },
    ]) {
      expect(classifySensitivity(meta).sensitive).toBe(false);
    }
  });

  it('accepts only plain metadata and has no way to read a value', () => {
    const meta = { type: 'text', labelText: 'Verification code', value: 'SHOULD-NEVER-APPEAR' };
    const result = classifySensitivity(meta);
    expect(JSON.stringify(result)).not.toContain('SHOULD-NEVER-APPEAR');
    expect(Object.keys(result).sort()).toEqual(['category', 'reason', 'sensitive']);
  });

  it('copes with missing metadata', () => {
    expect(classifySensitivity().sensitive).toBe(false);
    expect(classifySensitivity({ type: null, name: undefined }).sensitive).toBe(false);
  });
});

describe('helpers', () => {
  it('normalises camelCase and punctuation', () => {
    expect(normaliseMetadataText('mpesaPin_Code-1')).toBe('mpesa pin code 1');
  });
  it('describes categories in plain words', () => {
    expect(describeCategory('otp')).toBe('one-time code');
    expect(describeCategory('unknown')).toBe('secret');
  });
});
