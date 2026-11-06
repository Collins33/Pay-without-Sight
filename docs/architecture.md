# Architecture

```text
 Side panel (UI)  <──validated messages──>  Service worker  <──validated messages──>  Content script (active tab)
 src/sidepanel                              src/background                           src/content
                                            ├─ coordinator.js  (all logic)
                                            ├─ workflow/       (config-driven stages)
                                            ├─ safety/         (pure, deterministic)
                                            ├─ commands/       (keyword grammar, no LLM)
                                            └─ toolkit/        (future seam, worker only)
```

## Components

**Service worker** is the single coordinator. `service-worker.js` only wires Chrome APIs (messaging, tabs, scripting, storage) to `coordinator.js`. The coordinator holds no state between events: every operation reloads workflow position from `chrome.storage.local` and the transaction state from `chrome.storage.session`, so suspension and restart lose nothing. Operations are serialised so load, change and save never interleave.

**Content script** is injected on demand with `chrome.scripting.executeScript` into the active tab only, after the user clicks the extension icon (`activeTab`). It is never declared in the manifest. It reads semantic DOM (`form-discovery.js`), observes changes (`page-observer.js`), and performs only permitted interactions (`interaction-manager.js`): focus, scroll, ordinary clicks, and explicit read-back. It refuses to click any control classified as consequential unless the service worker supplies a well-formed, matching, unexpired grant.

**Workflow engine** identifies the current stage from the page's exact origin and path (never from page content), words the next instruction, and tracks the furthest step reached. Stages live in config (`src/demo/demo-workflow.js`).

**Safety manager** (`src/safety/`) is pure JavaScript with no DOM, Chrome or AI dependency:

- `sensitive-data-policy.js` classifies a field from metadata only. It is never given an element or a value.
- `confirmation-gate.js` issues, validates, expires, consumes and invalidates a single token bound to a kind and a details key.
- `transaction-manager.js` holds the one pending submission or payment, enforces prerequisites (no payment before submission), checks payment totals, and invalidates a confirmation when any detail changes.

**Side panel** renders the view the coordinator builds. It holds no authority: it can only ask the coordinator to confirm or execute.

## Consequential action path

```text
user types "pay"  ──>  opens review only (no authority)
page re-read      ──>  transaction-manager.update(details)   (change => invalidate)
user presses Confirm payment  ──>  gate.issue(kind, detailsKey)         [separate from submission]
user presses Pay now          ──>  re-read page, gate.consume(...)  ──>  grant
service worker  ──CLICK + grant──>  content script re-checks kind + expiry  ──>  one click
```

Defence in depth: the coordinator's gate and the content script's own check are independent. A command, a language model, or a page script cannot skip either.

## Persistence

| Data | Where | Why |
|---|---|---|
| Workflow position (`pws.workflow.v1`) | `chrome.storage.local` | survives browser restart |
| App prefs (`pws.prefs.v1`) | `chrome.storage.local` | own namespace, separate from any library |
| Pending transaction and confirmation (`pws.tx.v1`) | `chrome.storage.session` | survives worker suspension, cleared when the browser closes, never written to disk |

No form values are stored. The only values ever held are ordinary fields the user explicitly asked to read back, kept in session storage and cleared on stage change.

## Messaging

Every message carries `{ v, type, payload }`. `message-contracts.js` validates schema, type, allowed sender role, payload fields, size and the sender's extension id on every receive. Roles are derived from Chrome-supplied sender data (extension id, URL, tab), never from message content.

## Security notes

- Page content is untrusted. Nothing from a page is evaluated. Selectors for display text come only from our own workflow config.
- No network calls, remote fonts or CDNs. Strict extension CSP: `script-src 'self'; object-src 'self'`.
- Permissions: `sidePanel`, `storage`, `activeTab`, `scripting`. No host permissions, no always-on content scripts.
- Field-change detection uses a salted hash computed inside the content script. Values never leave the page.
