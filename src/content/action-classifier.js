// Pure text rules that decide whether a button is ordinary navigation or a consequential action.

const NAVIGATION = /^(continue|next|back|previous|go back|save and continue|skip|close|help|start|start application|back to home|ok)$/;
const FORWARD = /^(continue|next|save and continue)$/;
const PAYMENT = /\b(pay|payment|checkout|check out|purchase|buy|place order|donate|transfer|send money|authori[sz]e payment)\b/;
const SUBMISSION = /\b(submit|confirm|apply now|finali[sz]e|complete (application|order|registration)|send application|approve|authori[sz]e|delete|cancel (subscription|account))\b/;

function clean(text) {
  return String(text ?? '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * @param {{text?:string, type?:string}} action
 * @returns {null|'submission'|'payment'} null means an ordinary, ungated control.
 */
export function classifyActionText({ text, type } = {}) {
  const t = clean(text);
  if (NAVIGATION.test(t)) return null;
  if (PAYMENT.test(t)) return 'payment';
  if (SUBMISSION.test(t)) return 'submission';
  // Unknown label on a real submit button: be conservative and gate it.
  if (String(type ?? '').toLowerCase() === 'submit') return 'submission';
  return null;
}

/** True for plain "Continue / Next" style controls that move forward without committing anything. */
export function isForwardNavigation(text) {
  return FORWARD.test(clean(text));
}
