# Pay Without Sight (v0 skeleton)

A Chrome extension (Manifest V3) that helps a blind screen-reader user understand and move through a multi-step government service, **without ever taking control of anything consequential**. It complements the user's screen reader and never replaces it.

You drive it by typing short commands in a side panel. It can describe the page, move focus, press ordinary buttons, fill in ordinary fields from what you type, and explain what each field needs. Everything it says comes back as text in the panel. There is no voice input or output yet.

- Standalone: no accounts, no backend, no network requests, no language model.
- Fake data and a simulated payment only. Do not use it with real credentials or real payments.
- Structured so the AI for Accessibility Toolkit can be plugged in later through one marked seam (`src/toolkit/`). The toolkit is **not** installed or referenced.

## Core principle

The extension assists with understanding and navigation. **The user stays in control of every consequential action.** PINs, passwords, OTPs and card security codes are typed by the user directly into the website. The extension identifies such fields from metadata only, never reads their value, and refuses to type into them.

## Contents

- [Quick start](#quick-start)
- [Try the full workflow](#try-the-full-workflow)
- [Commands](#commands)
- [Typing into fields](#typing-into-fields)
- [How submission and payment work](#how-submission-and-payment-work)
- [Settings](#settings-stored-on-this-device)
- [Test on another website](#test-on-another-website)
- [Dependencies](#dependencies-all-dev-only)
- [Known limitations](#known-limitations)
- [Troubleshooting](#troubleshooting)

## Quick start

Prerequisites: Google Chrome 114 or newer (side panel support), and Node.js 18 or newer with npm (only to build, test, or run the demo site).

```bash
npm install
npm test          # unit, DOM, axe-core and build checks
npm run build     # writes the extension to dist/
npm run demo      # serves the fake permit service at http://localhost:4173/
```

Load the extension in Chrome:

1. Open `chrome://extensions`.
2. Switch on **Developer mode** (top right).
3. Choose **Load unpacked** and select the **`dist/`** folder.
4. Pin the extension: click the puzzle-piece icon in the toolbar, then the pin next to **Pay Without Sight**.

Open the side panel: go to the website you want help with, then click the **Pay Without Sight** toolbar icon. The panel opens beside the page and Chrome grants the extension temporary access to that tab (`activeTab`). Focus lands in the instruction box. Type a command and press Enter or the Run button.

Keyboard: `Alt+Shift+P` is registered as the action shortcut (see limitations).

After changing code, run `npm run build`, then press the reload icon on the extension's card in `chrome://extensions`.

Keep the demo port at 4173: the demo workflow is matched by exact origin (`http://localhost:4173`).

## Try the full workflow

This walks through the whole demo using only the side panel. Open `http://localhost:4173/`, click the extension icon, and type each command in the panel. Use fake data only.

### 1. Home page: start the application

| Type | What happens |
|---|---|
| `where am I` | Gives the page title and says there are no form fields |
| `click start application` | Presses the button. The panel confirms, for example: `Pressed "Start application". You are on "Step 1 of 5: Personal details…"`, with the stage and field counts |

### 2. Personal details: fill in fields

| Type | What happens |
|---|---|
| `what fields are there` | Numbered list of every field and its state, plus the page's buttons |
| `go to full name` | Moves focus to Full name and describes it |
| `Wanjiru Kamau` | Not a command, so it is typed into the focused field. The panel says `Filled "Full name"` |
| `next` | Moves to the next required field that is still empty (National ID number) |
| `details about this field` | Describes the field: type, required, state, the page's own hint (for example "8 digits, no spaces"), length limits and choices |
| `12345678` | Fills National ID number |
| `next`, then `+254712345678` | Phone number |
| `next`, then `type 14` | Date of birth: Day |
| `next`, `type 6`, `next`, `type 1990` | Month and Year |
| `click continue` | Presses Continue and reports that you are now on Step 2 |

Try leaving Full name empty and running `click continue`. The page shows validation errors, and the panel reports them, starting with "Enter your full name."

### 3. Service information: dropdown, radio buttons, checkbox

| Type | What happens |
|---|---|
| `go to service` | Focus on the dropdown |
| `details` | Lists the choices |
| `type renew` | Picks `Renew business permit` and confirms the choice |
| `next`, then `PN-12345` | Permit number |
| `next`, then `type office` | Chooses "Collect from the county office" |
| `next`, then `type yes` | Checks the declaration |
| `continue` | Moves to Review |

### 4. Review, payment and receipt

On the review step, run `list fields`. The verification code is marked sensitive and the extension will not type into it: type the code yourself on the page. Then use `submit` to open the review in the panel and confirm it there. See [How submission and payment work](#how-submission-and-payment-work).

### Things worth trying

- `click submit` is refused: it tells you to say `submit` instead, which opens the review. Clicking never sends or pays.
- On a sensitive field, type anything. It refuses and tells you to type it yourself.
- On a Day field (limit 2 characters), `type 123` is refused and nothing is typed.
- On the dropdown, `type re` matches two choices, so the panel lists them and asks you to pick one.
- `clear` empties a text field, or unchecks a checkbox.

## Commands

| Command | What it does |
|---|---|
| `where am I` | Page title, stage, field count, required count, empty count, visible errors |
| `list fields` (or `what fields are there`) | Each field: name, type, required or optional, filled or empty, sensitive or not. Never values. Also lists the buttons |
| `go to <label>` | Focuses the best match and announces it. Lists options if several match |
| `next` (or `next field`, `go to the next field`) | Moves to the next unfilled required field |
| `click <label>` | Presses an ordinary button or link by name, then waits for the page to change and says where you are. Submit and payment buttons are refused (use `submit` or `pay`) |
| `details` (or `details about this field`) | Requirements of the field you are on: type, required, state, the page's hint, length or range limits, expected format, choices |
| `type <text>` or just the text | Puts the text in the field you are on. See [Typing into fields](#typing-into-fields) |
| `clear` | Empties the field you are on (unchecks a checkbox) |
| `explain this stage` | Plain-language summary of the step |
| `continue` | Presses an ordinary Continue button (never a consequential one) and reports the new page |
| `read back <label>` | Reads one ordinary field aloud. Off by default, enable in Settings. Never works on sensitive fields |
| `read receipt` | Reads the receipt on the receipt step |
| `submit` / `pay` | Opens the review in the panel. Sends nothing |
| `help` | Lists commands |

## Typing into fields

The command box doubles as the place you type values. Text that is not a command is put into the field that currently has focus. Use `go to <label>` or `next` first to choose the field.

- **Text and number fields:** the text you type.
- **Dropdowns and radio groups:** a choice, by its label or its value. `type renew` and `type Renew business permit` both work. If more than one choice matches, the panel lists them. If none match, it lists the choices.
- **Checkboxes:** `type yes` or `type no`.
- **Confirmation:** the panel says which field was filled. It never repeats what you typed.
- **Limits:** a value longer than the field's maximum length is refused, and so is a value the browser will not accept, such as a wrong format in a date field.
- **Sensitive fields are always refused:** one-time codes, card security codes and passwords. This is checked in the side panel logic and checked again inside the page.
- **Commands as values:** text that starts with a command word, such as `Read Smith`, is not typed. The panel asks you to say `type Read Smith` instead.
- **Mistyped commands:** a mistyped command that does not start with a command word (for example `lst fields`) is typed into the focused field. The panel names the field, and `clear` undoes it.

## How submission and payment work

1. On the review step, the panel shows what will be submitted (fields as filled or empty) and a **Confirm submission** button.
2. After you confirm, a **Submit application now** button appears. Only that button sends it. The confirmation lasts 2 minutes and works once.
3. If anything changes after you confirm, including typing into a field, the confirmation is cancelled and the panel says so.
4. Payment is separate: recipient, amount, fees, total and purpose are shown, with its own **Confirm payment** then **Pay now**. A submission confirmation can never pay.

## Settings (stored on this device)

Announcement detail (normal or minimal), instruction text size, and whether read-back on request is allowed (off by default).

## Test on another website

Open any ordinary `http` or `https` page, click the extension icon, then try `where am I`, `list fields`, `go to <label>`, `next`, `details`. You can also type into ordinary fields and use `click` on ordinary buttons. On non-demo sites the stage is "unknown page", and the extension will never press a submit or payment button for you.

## Dependencies (all dev-only)

| Package | Why |
|---|---|
| `esbuild` | Bundles the service worker, content script and panel script into `dist/` |
| `vitest` | Test runner |
| `jsdom` | DOM for the form-discovery, interaction and panel tests |
| `axe-core` | Automated accessibility check of the side panel HTML |

There are no runtime dependencies.

## Known limitations

- Version 0 skeleton. Only the demo site has a configured workflow. Other sites get generic field discovery, clicking and typing only.
- No voice input or output yet. All input and output is text in the panel.
- `activeTab` access ends when you navigate to a different site. Click the icon again.
- Chrome blocks extensions on `chrome://` pages, the Chrome Web Store and some other protected pages.
- Only the top frame is read. Fields inside iframes or shadow DOM are not discovered.
- Typing supports text and number fields, dropdowns, radio groups and checkboxes. File uploads and custom widgets built from non-standard elements are not supported.
- A mistyped command can be typed into the focused field. The confirmation names the field and `clear` undoes it.
- Whether a button is "consequential" is judged from its label (for example Pay, Submit, Confirm). An unusual label can be missed. This only matters for the extension's own clicking, which is limited to ordinary navigation.
- If a click or confirmed action navigates away and the site never reaches the next step, the panel may keep showing "waiting for response" until you press **Reset progress**.
- After a click, the extension waits about two seconds for the page to change. On a slow page it may say it does not see the change yet. Run `where am I` to check.
- The `Alt+Shift+P` shortcut was not verified in a real Chrome session.
- Automated tests cannot prove the experience works for a blind user. See `docs/manual-test-script.md`.

## Troubleshooting

- **"I can't read this page right now"**: click the toolbar icon while the page is open, or the page is a protected Chrome page.
- **Panel says the extension is not responding**: close and reopen the panel, or reload the extension at `chrome://extensions`.
- **Nothing happens on the demo site**: confirm `npm run demo` is running and the address is exactly `http://localhost:4173/`.
- **Changes not showing**: run `npm run build`, then press the reload icon on the extension card.
- **"Failed to load extension" or "Manifest is not valid JSON"**: you chose the wrong folder, or the build did not finish. Run `npm run build`, confirm `dist/manifest.json` exists, and load the `dist/` folder.
- **A typed value went somewhere unexpected**: the value goes into the field that has focus. Say `go to <label>` first, and say `clear` to empty a field.
- **`click` says it cannot find a button**: run `list fields`, which also lists the page's buttons, and use a name from that list.
- **Footer**: should read "Toolkit: not integrated (standalone mode)".
