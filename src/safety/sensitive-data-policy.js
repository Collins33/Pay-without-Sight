// Classifies a form control as sensitive from METADATA ONLY. It never receives an element or a value.

const SENSITIVE_AUTOCOMPLETE = new Set([
  'one-time-code',
  'current-password',
  'new-password',
  'cc-number',
  'cc-csc',
  'cc-exp',
  'cc-exp-month',
  'cc-exp-year',
  'cc-type',
]);

// Each rule is tested against a normalised, space-separated, lower-case token string.
const TEXT_RULES = [
  { category: 'otp', re: /\b(otp|one time (code|password|pin)|verification code|sms code|auth(entication)? code|2fa|mfa)\b/ },
  { category: 'pin', re: /\b(pin|mpesa pin|m pesa pin|payment pin)\b/ },
  { category: 'password', re: /\b(password|passcode|passphrase|secret)\b/ },
  { category: 'card-security-code', re: /\b(cvv|cvc|csc|security code|card code|card verification)\b/ },
  { category: 'card-number', re: /\b(card number|card no|credit card number|debit card number)\b/ },
];

/** Lower-cases, splits camelCase, and turns every non-alphanumeric run into one space. */
export function normaliseMetadataText(value) {
  return String(value ?? '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * @param {{type?:string, autocomplete?:string, name?:string, id?:string, labelText?:string,
 *          ariaLabel?:string, describedText?:string, placeholder?:string}} meta
 * @returns {{sensitive:boolean, category:string|null, reason:string|null}}
 */
export function classifySensitivity(meta = {}) {
  const type = String(meta.type ?? '').toLowerCase();

  const tokens = String(meta.autocomplete ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  for (const t of tokens) {
    if (SENSITIVE_AUTOCOMPLETE.has(t)) {
      const category = t === 'one-time-code' ? 'otp' : t.endsWith('password') ? 'password' : t === 'cc-csc' ? 'card-security-code' : 'card-number';
      return { sensitive: true, category, reason: `autocomplete is ${t}` };
    }
  }

  const haystacks = [meta.name, meta.id, meta.labelText, meta.ariaLabel, meta.describedText, meta.placeholder];
  for (const h of haystacks) {
    const text = normaliseMetadataText(h);
    if (!text) continue;
    for (const rule of TEXT_RULES) {
      if (rule.re.test(text)) return { sensitive: true, category: rule.category, reason: 'label or name suggests a secret' };
    }
  }
  // Generic fallback, checked last so a more specific category (for example a card security code
  // typed into a password-style input) is announced accurately.
  if (type === 'password') return { sensitive: true, category: 'password', reason: 'input type is password' };
  return { sensitive: false, category: null, reason: null };
}

const CATEGORY_WORDS = {
  otp: 'one-time code',
  pin: 'PIN',
  password: 'password',
  'card-security-code': 'card security code',
  'card-number': 'card number',
};

/** Plain-language label for a category, used when announcing a sensitive field. */
export function describeCategory(category) {
  return CATEGORY_WORDS[category] ?? 'secret';
}
