// Turns a parsed command plus page data into a short spoken-style result. Pure apart from injected actions.
import { COMMAND_HELP } from './command-parser.js';
import { matchControls, pickNextField } from './field-matcher.js';
import { describeCategory } from '../safety/sensitive-data-policy.js';
import { isForwardNavigation } from '../content/action-classifier.js';

const TYPE_WORDS = {
  text: 'text', tel: 'phone number', email: 'email', password: 'password', number: 'number', date: 'date', url: 'web address',
  select: 'dropdown list', multiselect: 'multi-select list', textarea: 'multi-line text', checkbox: 'checkbox', search: 'search',
};

export const NEED_ACCESS = 'I can\'t read this page right now. Click the Pay Without Sight icon (or press Alt+Shift+P) while the page is open, then try again. Some Chrome pages can never be read by extensions.';

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function typeWord(field) {
  if (field.type === 'radio-group') return `choice of ${field.optionCount ?? 'several'}`;
  return TYPE_WORDS[field.type] ?? field.type;
}

export function stateWord(field) {
  if (field.sensitive) return `sensitive ${describeCategory(field.sensitiveCategory)}, I do not check or read it`;
  if (field.type === 'checkbox') return field.filled ? 'checked' : 'unchecked';
  return field.filled ? 'filled' : 'empty';
}

/** One field described the way it is announced. Never includes a value. */
export function describeField(field) {
  const parts = [field.name, typeWord(field), field.required ? 'required' : 'optional', stateWord(field)];
  let text = parts.join(', ') + '.';
  if (field.description) text += ` ${field.description}`;
  if (field.invalid) text += ` Error: ${field.errorText || 'this field is marked invalid'}`;
  return text;
}

function stageLine(stageInfo, verbose) {
  if (stageInfo?.stage) return `Stage: ${stageInfo.stage.title}, step ${stageInfo.index + 1} of ${stageInfo.total}.`;
  if (stageInfo?.matched) return verbose ? 'This is the guided site but not one of its steps.' : 'Not a guided step.';
  return verbose ? 'Stage: unknown page, there is no guided workflow for this site.' : 'Unknown page.';
}

function whereAmI(ctx) {
  const { page, stageInfo } = ctx;
  const verbose = ctx.prefs.verbosity !== 'minimal';
  const c = page.counts;
  const title = page.title || 'Untitled page';
  const fieldsText = c.fields === 0
    ? 'No form fields found.'
    : verbose
      ? `${plural(c.fields, 'field')}, ${c.required} required, ${c.empty} empty${c.empty ? ` (${c.requiredEmpty} of them required)` : ''}.${c.sensitive ? ` ${plural(c.sensitive, 'sensitive field')} not checked.` : ''}`
      : `${plural(c.fields, 'field')}, ${c.empty} empty.`;
  const errorsText = c.errors
    ? (verbose ? `${plural(c.errors, 'error')} showing. First: ${page.errors[0].text}` : `${plural(c.errors, 'error')}.`)
    : (verbose ? 'No errors showing.' : '');
  const message = verbose
    ? `You are on "${title}". ${stageLine(stageInfo, true)} ${fieldsText} ${errorsText}`
    : `${title}. ${stageLine(stageInfo, false)} ${fieldsText} ${errorsText}`;
  return { ok: true, message: message.replace(/\s+/g, ' ').trim() };
}

function listFields(ctx) {
  const { page } = ctx;
  if (!page.fields.length) return { ok: true, message: 'No form fields found on this page.' };
  const lines = page.fields.map((f, i) => `${i + 1}. ${describeField(f)}`);
  const buttons = page.actions.filter((a) => !a.disabled);
  if (buttons.length) {
    lines.push(`Buttons: ${buttons.map((a) => (a.consequentialKind ? `${a.name} (needs your confirmation)` : a.name)).join('; ')}.`);
  }
  return { ok: true, message: `${plural(page.fields.length, 'field')}. I never read what is in them.`, lines };
}

async function goTo(ctx, arg) {
  if (!arg) return { ok: false, message: 'Say which field: go to, then its label.' };
  const m = matchControls(ctx.page.fields, ctx.page.actions, arg);
  if (m.status === 'none') return { ok: false, message: `I couldn't find anything matching "${arg}". Try: list fields.` };
  if (m.status === 'ambiguous') {
    const names = m.options.map((o) => o.name);
    return { ok: false, message: `More than one match for "${arg}". Say go to, then one of these:`, lines: names };
  }
  const res = await ctx.focusControl(m.item.id);
  if (!res?.ok) return { ok: false, message: `I found "${m.item.name}" but couldn't move focus to it.` };
  if (m.kind === 'action') {
    const note = m.item.consequentialKind
      ? ' This button commits something. I only moved focus; pressing it is your decision.'
      : '';
    return { ok: true, message: `${m.item.name} button.${note}` };
  }
  return { ok: true, message: describeField(m.item) };
}

async function nextField(ctx) {
  const pick = pickNextField(ctx.page.fields, ctx.page.focusedId);
  if (!pick) return { ok: true, message: 'No required field is empty and nothing shows an error. Say "continue" or "explain this stage".' };
  const res = await ctx.focusControl(pick.field.id);
  if (!res?.ok) return { ok: false, message: `I couldn't move focus to "${pick.field.name}".` };
  const lead = {
    'empty-required': 'Next required field: ',
    invalid: 'This field has an error: ',
    'sensitive-required': 'Required sensitive field, I cannot tell whether it is filled. Type it yourself: ',
  }[pick.reason];
  return { ok: true, message: lead + describeField(pick.field) };
}

function explain(ctx) {
  const { stageInfo, page } = ctx;
  if (!stageInfo?.stage) return { ok: true, message: 'This page is not one of the guided steps. I can still list fields and take you to them. Say "help".' };
  return { ok: true, message: ctx.engine.explain(stageInfo.stage, page) };
}

async function continueCommand(ctx) {
  const target = ctx.page.actions.find((a) => !a.consequentialKind && !a.disabled && isForwardNavigation(a.name));
  if (!target) return { ok: false, message: 'I can\'t find a Continue button on this page.' };
  const res = await ctx.clickAction(target.id);
  // A click that loads a new page can close the reply channel; the bridge reports that as navigated.
  if (!res?.ok && !res?.navigated) return { ok: false, message: `I couldn't press "${target.name}".` };
  return { ok: true, message: await afterClick(ctx, target.name) };
}

async function beginReview(ctx, kind) {
  const stage = ctx.stageInfo?.stage;
  if (!stage || stage.consequential !== kind) {
    return { ok: false, message: `I only help with the ${kind} on the ${kind} step of a guided service. On other sites, use the site's own button yourself. I will never press it for you.` };
  }
  const res = await ctx.beginTransaction(kind);
  if (!res.ok) return { ok: false, message: res.reason };
  const confirm = kind === 'payment' ? 'Confirm payment' : 'Confirm submission';
  const run = kind === 'payment' ? 'Pay now' : 'Submit application now';
  return { ok: true, focusConfirm: true, message: `The ${kind} review is open in the panel. Nothing happens until you press "${confirm}", and then "${run}".` };
}

async function readBack(ctx, arg) {
  if (!ctx.prefs.readBackEnabled) return { ok: false, message: 'Reading values back is off. Turn it on in Settings first. Nothing was read.' };
  if (!arg) return { ok: false, message: 'Say which field: read back, then its label.' };
  const m = matchControls(ctx.page.fields, [], arg);
  if (m.status === 'none') return { ok: false, message: `I couldn't find a field matching "${arg}".` };
  if (m.status === 'ambiguous') return { ok: false, message: `More than one match for "${arg}". Say read back, then one of these:`, lines: m.options.map((o) => o.name) };
  if (m.item.sensitive) return { ok: false, message: `"${m.item.name}" is a sensitive field. I never read it. Type it yourself.` };
  const res = await ctx.readBackValue(m.item.id);
  if (!res?.ok) return { ok: false, message: `I couldn't read "${m.item.name}".` };
  ctx.rememberReadBack?.(m.item.name, res.value);
  return { ok: true, message: `${m.item.name}: ${res.value || 'empty'}. Read locally at your request. It stays on this device.` };
}

async function readReceipt(ctx) {
  const selector = ctx.workflow?.receiptSelector;
  if (ctx.stageInfo?.stage?.id !== 'receipt' || !selector) return { ok: false, message: 'There is no receipt on this page.' };
  const res = await ctx.readText(selector);
  if (!res?.ok) return { ok: false, message: 'I couldn\'t find the receipt on this page.' };
  return { ok: true, message: `Receipt: ${res.text}` };
}

// ---- click, type into a field, and describe a field -------------------------------------------------------

// Plain text that matches no command is typed into the focused field. Text that starts with a command word is not,
// so a mistyped command is never silently stored as a value; "type <text>" is the way to enter such text.
const COMMAND_WORDS = new Set([
  'go', 'goto', 'focus', 'jump', 'read', 'click', 'press', 'list', 'next', 'where', 'explain', 'help', 'commands',
  'continue', 'submit', 'pay', 'clear', 'details', 'what', 'fields', 'type', 'enter', 'fill', 'give', 'tell', 'describe',
]);
const looksLikeCommand = (raw) => COMMAND_WORDS.has(String(raw ?? '').trim().toLowerCase().split(/\s+/)[0]);

const focusedField = (ctx) => ctx.page.fields.find((f) => f.id === ctx.page.focusedId) ?? null;

function fillProblem(field, res) {
  switch (res?.reason) {
    case 'sensitive': return { message: `"${field.name}" is a sensitive field. I never type into it. Type it yourself on the page.` };
    case 'not_editable': return { message: `"${field.name}" can't be edited right now.` };
    case 'no_such_option': return { message: `I couldn't match that to a choice for "${field.name}". The choices are:`, lines: res.options ?? [] };
    case 'ambiguous_option': return { message: 'More than one choice matches. Say type, then one of these:', lines: res.options ?? [] };
    case 'unsupported_value': return { message: `"${field.name}" is a checkbox. Say type yes, or type no.` };
    case 'too_long': return { message: `"${field.name}" allows at most ${res.max} characters. Nothing was typed.` };
    case 'format_rejected': return { message: `"${field.name}" did not accept that. Say details to hear what it expects.` };
    case 'unsupported_type': return { message: `I can't type into "${field.name}" this way. Use the page's own control for it.` };
    default: return { message: `I couldn't fill "${field.name}".` };
  }
}

async function fillFocused(ctx, text, { clear = false, explicit = true } = {}) {
  const field = focusedField(ctx);
  if (!field) {
    return {
      ok: false,
      message: explicit
        ? 'No field is focused. Say go to, then a field label, or say next.'
        : "I didn't understand that, and no field is focused to type into. Try: help, or say go to, then a field label.",
    };
  }
  if (field.sensitive) return { ok: false, ...fillProblem(field, { reason: 'sensitive' }) };
  let value = String(text ?? '').trim();
  if (clear) {
    if (field.type === 'checkbox') value = 'no';
    else if (['select', 'multiselect', 'radio-group'].includes(field.type)) {
      return { ok: false, message: `I can't clear "${field.name}" from here. Pick another choice with type, then the choice.` };
    } else value = '';
  } else if (!value) {
    return { ok: false, message: 'Say what to type: type, then the text.' };
  }
  const res = await ctx.fillValue(field.id, value);
  if (!res?.ok) return { ok: false, ...fillProblem(field, res) };
  let done;
  if (clear) done = field.type === 'checkbox' ? `Unchecked "${field.name}".` : `Cleared "${field.name}".`;
  else if (res.chosen) done = `Chose "${res.chosen}" for "${field.name}".`;
  else if (field.type === 'checkbox') done = `${res.checked ? 'Checked' : 'Unchecked'} "${field.name}".`;
  else done = `Filled "${field.name}".`;
  const textLike = !['checkbox', 'select', 'multiselect', 'radio-group'].includes(field.type);
  return { ok: true, message: `${done} Say "next" to move on or "details" to hear about this field.${textLike && !clear ? ' Say "clear" to empty it.' : ''}` };
}

function fieldDetails(ctx) {
  const f = focusedField(ctx);
  if (!f) return { ok: false, message: 'No field is focused. Say go to, then a field label, or say next.' };
  const c = f.constraints ?? {};
  const lines = [`${typeWord(f)}, ${f.required ? 'required' : 'optional'}.`];
  if (f.sensitive) lines.push(`Sensitive ${describeCategory(f.sensitiveCategory)}. I never read or fill it. Type it yourself on the page.`);
  else lines.push(`Right now it is ${stateWord(f)}.`);
  if (f.description) lines.push(`The page says: ${f.description}`);
  if (c.minlength || c.maxlength) {
    lines.push(`Length: ${[c.minlength && `at least ${c.minlength}`, c.maxlength && `at most ${c.maxlength}`].filter(Boolean).join(', ')} characters.`);
  }
  if (c.min || c.max) lines.push(`Range: ${[c.min && `from ${c.min}`, c.max && `to ${c.max}`].filter(Boolean).join(' ')}.`);
  if (c.pattern) lines.push(`The page checks a specific format (pattern ${c.pattern}).`);
  if (c.options?.length) lines.push(`Choices: ${c.options.join('; ')}. Say type, then the choice.`);
  if (f.type === 'checkbox') lines.push('Say type yes to check it, or type no to clear it.');
  if (f.invalid) lines.push(`Error: ${f.errorText || 'this field is marked invalid'}`);
  return { ok: true, message: `Details for "${f.name}":`, lines };
}

/** After a click: wait briefly for the page to change, then say where we are. */
async function afterClick(ctx, name) {
  const next = ctx.waitForPageChange ? await ctx.waitForPageChange() : null;
  if (ctx.waitForPageChange && !next) return `Pressed "${name}". I don't see the page change yet. Say "where am I" to check.`;
  if (!next) return `Pressed "${name}". Say "where am I" once the next page has loaded.`;
  return `Pressed "${name}". ${whereAmI({ ...ctx, page: next.page, stageInfo: next.stageInfo }).message}`;
}

async function clickCommand(ctx, arg) {
  if (!arg) return { ok: false, message: 'Say which button: click, then its name.' };
  const m = matchControls([], ctx.page.actions, arg);
  if (m.status === 'none') return { ok: false, message: `I couldn't find a button matching "${arg}". Try: list fields, which also lists the buttons.` };
  if (m.status === 'ambiguous') {
    return { ok: false, message: `More than one button matches "${arg}". Say click, then one of these:`, lines: m.options.map((o) => o.name) };
  }
  const button = m.item;
  if (button.consequentialKind) {
    const say = button.consequentialKind === 'payment' ? 'pay' : 'submit';
    return { ok: false, message: `"${button.name}" commits something, so I won't press it from a click command. Say "${say}" to open the review instead.` };
  }
  if (button.disabled) return { ok: false, message: `"${button.name}" is disabled right now.` };
  const res = await ctx.clickAction(button.id);
  if (!res?.ok && !res?.navigated) return { ok: false, message: `I couldn't press "${button.name}".` };
  return { ok: true, message: await afterClick(ctx, button.name) };
}

/**
 * @param {{command:string,arg?:string}} parsed
 * @param {object} ctx page, stageInfo, prefs, engine, workflow, and action callbacks
 * @returns {Promise<{ok:boolean, message:string, lines?:string[], focusConfirm?:boolean}>}
 */
export async function runCommand(parsed, ctx) {
  switch (parsed.command) {
    case 'help':
      return { ok: true, message: 'Commands:', lines: COMMAND_HELP };
    case 'unknown':
      if (!ctx.page) return { ok: false, message: "I didn't understand that. Try: help." };
      if (looksLikeCommand(parsed.raw)) {
        return { ok: false, message: "I didn't understand that command. Try: help. To put those words in the field you are on, say type, then the text." };
      }
      break; // plain text: handled below as a value for the focused field
    default:
      break;
  }
  if (!ctx.page) return { ok: false, message: ctx.problem || NEED_ACCESS };
  switch (parsed.command) {
    case 'where_am_i': return whereAmI(ctx);
    case 'list_fields': return listFields(ctx);
    case 'go_to': return goTo(ctx, parsed.arg);
    case 'next': return nextField(ctx);
    case 'explain': return explain(ctx);
    case 'continue': return continueCommand(ctx);
    case 'submit': return beginReview(ctx, 'submission');
    case 'pay': return beginReview(ctx, 'payment');
    case 'read_back': return readBack(ctx, parsed.arg);
    case 'read_receipt': return readReceipt(ctx);
    case 'click': return clickCommand(ctx, parsed.arg);
    case 'fill': return fillFocused(ctx, parsed.arg);
    case 'clear': return fillFocused(ctx, '', { clear: true });
    case 'field_details': return fieldDetails(ctx);
    case 'unknown': return fillFocused(ctx, parsed.raw, { explicit: false });
    default: return { ok: false, message: "I didn't understand that. Try: help." };
  }
}
