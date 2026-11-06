// Message contracts: builds and strictly validates every message between side panel, service worker and content script.

export const PROTOCOL_VERSION = 1;
const MAX_MESSAGE_CHARS = 20_000;

export const MSG = Object.freeze({
  // side panel -> service worker
  GET_VIEW: 'pws/get-view',
  COMMAND: 'pws/command',
  GET_STATUS: 'pws/get-status',
  SET_PREFS: 'pws/set-prefs',
  CONFIRM: 'pws/confirm',
  EXECUTE: 'pws/execute',
  CANCEL_TX: 'pws/cancel-tx',
  RESET: 'pws/reset',
  // content script -> service worker
  PAGE_EVENT: 'pws/page-event',
  // service worker -> side panel
  VIEW_UPDATE: 'pws/view-update',
  // service worker -> content script
  PING: 'pws/ping',
  DISCOVER: 'pws/discover',
  FOCUS: 'pws/focus',
  CLICK: 'pws/click',
  READ_BACK: 'pws/read-back',
  READ_TEXT: 'pws/read-text',
  FILL: 'pws/fill',
});

const KIND = { type: 'string', enum: ['submission', 'payment'], required: true };
const ID = { type: 'string', maxLength: 64, required: true };

/** type -> { from: allowed sender roles, payload: field schema } */
const SCHEMAS = {
  [MSG.GET_VIEW]: { from: ['sidepanel'], payload: {} },
  [MSG.COMMAND]: { from: ['sidepanel'], payload: { text: { type: 'string', maxLength: 200, required: true } } },
  [MSG.GET_STATUS]: { from: ['sidepanel'], payload: {} },
  [MSG.SET_PREFS]: { from: ['sidepanel'], payload: { prefs: { type: 'object', required: true } } },
  [MSG.CONFIRM]: { from: ['sidepanel'], payload: { kind: KIND } },
  [MSG.EXECUTE]: { from: ['sidepanel'], payload: { kind: KIND } },
  [MSG.CANCEL_TX]: { from: ['sidepanel'], payload: {} },
  [MSG.RESET]: { from: ['sidepanel'], payload: {} },
  [MSG.PAGE_EVENT]: { from: ['content'], payload: { reason: { type: 'string', enum: ['input', 'mutation', 'ready'], required: true } } },
  [MSG.VIEW_UPDATE]: { from: ['service-worker'], payload: {} },
  [MSG.PING]: { from: ['service-worker'], payload: {} },
  [MSG.DISCOVER]: {
    from: ['service-worker'],
    payload: {
      detailSelectors: { type: 'stringMap', maxEntries: 12, maxLength: 120 },
      fingerprintSelectors: { type: 'stringMap', maxEntries: 12, maxLength: 120 },
      receiptSelector: { type: 'string', maxLength: 120 },
    },
  },
  [MSG.FOCUS]: { from: ['service-worker'], payload: { fieldId: ID } },
  [MSG.CLICK]: {
    from: ['service-worker'],
    payload: {
      actionId: ID,
      grant: { type: 'object' },
    },
  },
  [MSG.READ_BACK]: { from: ['service-worker'], payload: { fieldId: ID } },
  [MSG.FILL]: { from: ['service-worker'], payload: { fieldId: ID, value: { type: 'string', maxLength: 200, required: true } } },
  [MSG.READ_TEXT]: { from: ['service-worker'], payload: { selector: { type: 'string', maxLength: 120, required: true } } },
};

export function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
}

/**
 * Works out which extension component sent a message. Returns null for anything that is not
 * from this extension (the sender id must equal our own extension id).
 */
export function senderRole(sender, ctx) {
  if (!sender || typeof sender !== 'object') return null;
  if (!ctx?.extensionId || sender.id !== ctx.extensionId) return null;
  const url = typeof sender.url === 'string' ? sender.url : '';
  // Check the URL first: Chrome sets it, and a web page cannot claim a chrome-extension:// URL.
  // (An extension page opened in a tab also carries sender.tab, so the tab alone cannot mean "content script".)
  if (ctx.sidepanelUrl && url === ctx.sidepanelUrl) return 'sidepanel';
  if (ctx.extensionOrigin && url.startsWith(ctx.extensionOrigin)) return sender.tab ? null : 'service-worker';
  if (sender.tab) return 'content';
  if (!url) return 'service-worker';
  return null;
}

function checkField(name, spec, value) {
  if (value === undefined) return spec.required ? `payload.${name} is required` : null;
  switch (spec.type) {
    case 'string':
      if (typeof value !== 'string') return `payload.${name} must be a string`;
      if (spec.maxLength && value.length > spec.maxLength) return `payload.${name} is too long`;
      if (spec.enum && !spec.enum.includes(value)) return `payload.${name} is not an allowed value`;
      return null;
    case 'object':
      return isPlainObject(value) ? null : `payload.${name} must be an object`;
    case 'stringMap': {
      if (!isPlainObject(value)) return `payload.${name} must be an object`;
      const entries = Object.entries(value);
      if (entries.length > (spec.maxEntries ?? 20)) return `payload.${name} has too many entries`;
      for (const [k, v] of entries) {
        if (typeof v !== 'string' || v.length > (spec.maxLength ?? 200) || k.length > 40) return `payload.${name} has an invalid entry`;
      }
      return null;
    }
    default:
      return `payload.${name} has an unsupported schema type`;
  }
}

/**
 * Validates an incoming message and its sender.
 * @returns {{ok:true,type:string,payload:object,role:string}|{ok:false,error:string}}
 */
export function validateMessage(msg, sender, ctx) {
  const role = senderRole(sender, ctx);
  if (!role) return { ok: false, error: 'Rejected: unexpected sender.' };
  if (!isPlainObject(msg)) return { ok: false, error: 'Rejected: message must be an object.' };
  let size;
  try {
    size = JSON.stringify(msg).length;
  } catch {
    return { ok: false, error: 'Rejected: message is not serialisable.' };
  }
  if (size > MAX_MESSAGE_CHARS) return { ok: false, error: 'Rejected: message too large.' };
  const extraTop = Object.keys(msg).filter((k) => !['v', 'type', 'payload'].includes(k));
  if (extraTop.length) return { ok: false, error: 'Rejected: unexpected message fields.' };
  if (msg.v !== PROTOCOL_VERSION) return { ok: false, error: 'Rejected: unsupported protocol version.' };
  if (typeof msg.type !== 'string' || !Object.hasOwn(SCHEMAS, msg.type)) return { ok: false, error: 'Rejected: unknown message type.' };
  const schema = SCHEMAS[msg.type];
  if (!schema.from.includes(role)) return { ok: false, error: `Rejected: ${role} may not send ${msg.type}.` };
  const payload = msg.payload === undefined ? {} : msg.payload;
  if (!isPlainObject(payload)) return { ok: false, error: 'Rejected: payload must be an object.' };
  const extra = Object.keys(payload).filter((k) => !Object.hasOwn(schema.payload, k));
  if (extra.length) return { ok: false, error: `Rejected: unexpected payload field ${extra[0]}.` };
  for (const [name, spec] of Object.entries(schema.payload)) {
    const problem = checkField(name, spec, payload[name]);
    if (problem) return { ok: false, error: `Rejected: ${problem}.` };
  }
  return { ok: true, type: msg.type, payload, role };
}

export function makeMessage(type, payload = {}) {
  return { v: PROTOCOL_VERSION, type, payload };
}

/** Validates the shape of a click grant that the service worker hands to the content script. */
export function isWellFormedGrant(grant) {
  return isPlainObject(grant) && typeof grant.kind === 'string' && ['submission', 'payment'].includes(grant.kind) &&
    typeof grant.token === 'string' && grant.token.length >= 8 && Number.isFinite(grant.expiresAt);
}
