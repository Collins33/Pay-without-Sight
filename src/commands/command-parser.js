// Deterministic keyword grammar for typed commands. No language model, no fuzzy guessing of consequential actions.

const EXACT = new Map([
  ['where am i', 'where_am_i'],
  ['where am i now', 'where_am_i'],
  ['list fields', 'list_fields'],
  ['list the fields', 'list_fields'],
  ['fields', 'list_fields'],
  ['next', 'next'],
  ['next field', 'next'],
  ['next required field', 'next'],
  ['explain this stage', 'explain'],
  ['explain stage', 'explain'],
  ['explain', 'explain'],
  ['what do i need to do', 'explain'],
  ['help', 'help'],
  ['commands', 'help'],
  ['continue', 'continue'],
  ['read receipt', 'read_receipt'],
  ['read the receipt', 'read_receipt'],
  ['read my receipt', 'read_receipt'],
  // Consequential commands match whole phrases only. They merely OPEN the review; they never execute anything.
  ['submit', 'submit'],
  ['submit application', 'submit'],
  ['submit the application', 'submit'],
  ['pay', 'pay'],
  ['pay now', 'pay'],
  ['make payment', 'pay'],
  ['make a payment', 'pay'],
]);

export const COMMAND_HELP = [
  'where am I: page, stage, field counts and errors',
  'list fields: every field, whether it is filled, never its value',
  'go to <label>: focus a field or button by name',
  'next: go to the next field that still needs filling',
  'explain this stage: what this step needs',
  'continue: press the Continue button when it is an ordinary step',
  'read back <label>: read one ordinary field aloud (only if turned on in settings)',
  'read receipt: read the receipt on the receipt step',
  'submit or pay: open the review; nothing is sent until you confirm in the panel',
  'help: this list',
];

function normalise(input) {
  return String(input ?? '')
    .slice(0, 200)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[?!.,;:]+$/g, '')
    .trim();
}

/**
 * @param {string} input
 * @returns {{command:string, arg?:string, raw:string}}
 */
export function parseCommand(input) {
  const raw = String(input ?? '');
  const text = normalise(raw);
  if (text === '' && raw.includes('?')) return { command: 'help', raw };
  if (EXACT.has(text)) return { command: EXACT.get(text), raw };

  let m = /^(?:go to|goto|focus|jump to)\s+(.+)$/.exec(text);
  if (m) return { command: 'go_to', arg: m[1].trim(), raw };

  m = /^read back\s+(.+)$/.exec(text) ?? /^read\s+(.+?)\s+back$/.exec(text);
  if (m) return { command: 'read_back', arg: m[1].trim(), raw };

  return { command: 'unknown', raw };
}
