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
  ['go to next', 'next'],
  ['go to next field', 'next'],
  ['go to the next field', 'next'],
  ['what fields are there', 'list_fields'],
  ['what fields are on this page', 'list_fields'],
  ['what are the fields', 'list_fields'],
  ['clear', 'clear'],
  ['clear field', 'clear'],
  ['clear this field', 'clear'],
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
  'click <label>: press an ordinary button or link by name (submit and pay stay behind their review)',
  'details: the requirements of the field you are on',
  'type <text>, or just type the text: put it in the field you are on',
  'clear: empty the field you are on',
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

  if (
    /^(?:(?:give|tell) me )?(?:the )?(?:details|requirements|info|information)(?: (?:about|of|for|on) (?:this|the current|the focused) field)?$/.test(text)
    || /^what are the (?:details|requirements)(?: of this field)?$/.test(text)
    || /^(?:describe|explain) (?:this|the current) field$/.test(text)
    || /^what (?:is|does) this field (?:need|require|want)$/.test(text)
  ) return { command: 'field_details', raw };

  m = /^(?:click|press)(?:\s+(?:on\s+)?(?:the\s+)?(.*))?$/.exec(text);
  if (m) return { command: 'click', arg: (m[1] ?? '').trim(), raw };

  // "type <value>" keeps the original capitalisation, so it reads from raw, not the lowercased text.
  m = /^(?:type|enter|fill)(?:\s+(.*))?$/i.exec(raw.trim());
  if (m) return { command: 'fill', arg: (m[1] ?? '').trim().slice(0, 200), raw };

  return { command: 'unknown', raw };
}
