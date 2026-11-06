# Pay Without Sight (v0 skeleton)

A Chrome extension (Manifest V3) that helps a blind screen-reader user understand and move through a multi-step government service, **without ever taking control of anything consequential**. It complements the user's screen reader and never replaces it.

- Standalone: no accounts, no backend, no network requests, no language model.
- Fake data and a simulated payment only. Do not use it with real credentials or real payments.
- Structured so the AI for Accessibility Toolkit can be plugged in later through one marked seam (`src/toolkit/`). The toolkit is **not** installed or referenced.

## Core principle

The extension assists with understanding and navigation. **The user stays in control of every consequential action.** PINs, passwords, OTPs and card security codes are typed by the user directly into the website. The extension identifies such fields from metadata only and never reads their value.

## Prerequisites

- Google Chrome 114 or newer (side panel support).
- Node.js 18 or newer and npm (only to build, test, or run the demo site).

## Install, test, build

```bash
npm install
npm test          # unit, DOM, axe-core and build checks
npm run build     # writes the extension to dist/
```

## Load it in Chrome

1. Open `chrome://extensions`.
2. Switch on **Developer mode** (top right).
3. Choose **Load unpacked** and select the **`dist/`** folder.
4. Pin the extension: click the puzzle-piece icon in the toolbar, then the pin next to **Pay Without Sight**.

## Open the side panel

Open the website you want help with, then click the **Pay Without Sight** toolbar icon. The panel opens beside the page and Chrome grants the extension temporary access to that tab (`activeTab`). Focus lands in the instruction box. Type a command and press Enter or the Run button.

Keyboard: `Alt+Shift+P` is registered as the action shortcut (see limitations).

## Run the demo site

```bash
npm run demo      # serves the fake permit service at http://localhost:4173/
```

Open `http://localhost:4173/`, press **Start application**, then click the extension icon. The demo has five steps: personal details, service information, review and submit, simulated payment, receipt. It includes a three-field date of birth, an error message (`personal.html?error=1`), a one-time-code field and a card security code field.

Keep the port at 4173: the demo workflow is matched by exact origin (`http://localhost:4173`).

## Commands

| Command | What it does |
|---|---|
| `where am I` | Page title, stage, field count, required count, empty count, visible errors |
| `list fields` | Each field: name, type, required or optional, filled or empty, sensitive or not. Never values |
| `go to <label>` | Focuses the best match and announces it. Lists options if several match |
| `next` | Moves to the next unfilled required field |
| `explain this stage` | Plain-language summary of the step |
| `continue` | Presses an ordinary Continue button (never a consequential one) |
| `read back <label>` | Reads one ordinary field aloud. Off by default, enable in Settings. Never works on sensitive fields |
| `read receipt` | Reads the receipt on the receipt step |
| `submit` / `pay` | Opens the review in the panel. Sends nothing |
| `help` | Lists commands |

Anything else returns: "I didn't understand that. Try: help."

## How submission and payment work

1. On the review step, the panel shows what will be submitted (fields as filled or empty) and a **Confirm submission** button.
2. After you confirm, a **Submit application now** button appears. Only that button sends it. The confirmation lasts 2 minutes and works once.
3. If anything changes after you confirm, the confirmation is cancelled and the panel says so.
4. Payment is separate: recipient, amount, fees, total and purpose are shown, with its own **Confirm payment** then **Pay now**. A submission confirmation can never pay.

## Settings (stored on this device)

Announcement detail (normal or minimal), instruction text size, and whether read-back on request is allowed (off by default).

## Test on another website

Open any ordinary `http` or `https` page, click the extension icon, then try `where am I`, `list fields`, `go to <label>`, `next`. On non-demo sites the stage is "unknown page", and the extension will never press a submit or payment button for you.

## Dependencies (all dev-only)

| Package | Why |
|---|---|
| `esbuild` | Bundles the service worker, content script and panel script into `dist/` |
| `vitest` | Test runner |
| `jsdom` | DOM for the form-discovery, interaction and panel tests |
| `axe-core` | Automated accessibility check of the side panel HTML |

There are no runtime dependencies.

## Known limitations

- Version 0 skeleton. Only the demo site has a configured workflow. Other sites get generic field discovery only.
- `activeTab` access ends when you navigate to a different site. Click the icon again.
- Chrome blocks extensions on `chrome://` pages, the Chrome Web Store and some other protected pages.
- Only the top frame is read. Fields inside iframes or shadow DOM are not discovered.
- Whether a button is "consequential" is judged from its label (for example Pay, Submit, Confirm). An unusual label can be missed. This only matters for the extension's own clicking, which is limited to ordinary navigation.
- If a confirmed action's click navigates away and the site never reaches the next step, the panel may keep showing "waiting for response" until you press **Reset progress**.
- The `Alt+Shift+P` shortcut was not verified in a real Chrome session.
- Automated tests cannot prove the experience works for a blind user. See `docs/manual-test-script.md`.

## Troubleshooting

- **"I can't read this page right now"**: click the toolbar icon while the page is open, or the page is a protected Chrome page.
- **Panel says the extension is not responding**: close and reopen the panel, or reload the extension at `chrome://extensions`.
- **Nothing happens on the demo site**: confirm `npm run demo` is running and the address is exactly `http://localhost:4173/`.
- **Changes not showing**: run `npm run build`, then press the reload icon on the extension card.
- **Footer**: should read "Toolkit: not integrated (standalone mode)".
