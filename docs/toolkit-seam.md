# Toolkit seam

The AI for Accessibility Toolkit is a separate, reusable accessibility library, not an application. Its documented entry point is `createToolkit({ ports })`, which returns `{ datastore, librarian }`. Ports include `KVStore` (required), `Clock`, `Scheduler`, `Consent` and an actuation port. It later supplies profile storage (AbilityModel, Librarian), a persistence layer, consent for adaptation proposals, skills and a registry, surface renderers, and a catalogue of adapters, auditors and validators. It does **not** supply multi-step form guidance, OTP or payment handling, or transaction confirmation. Those are built here.

Version 0 builds the seam only. Nothing from the toolkit is installed, imported or mocked. Every name in the right-hand column comes from the project brief and **must be verified against the toolkit's own source** before wiring.

| Seam | v0 (ours) | When the toolkit arrives (to verify against its source) |
|---|---|---|
| Profile store | own prefs in `chrome.storage` | Librarian and AbilityModel profile |
| Persistence port | `chrome.storage.local` wrapper | `KVStore` implementation |
| Adaptation consent | none | `Consent` port surfaced in the side panel |
| Display settings | own text size setting | web surface renderer |
| Skills | none | skills and registry |
| Page audit | basic label and name check in `form-discovery.js` | auditors such as unlabeled controls |
| AI | none | optional, via a backend. Never an authority over transactions |

## Files

| File | Job |
|---|---|
| `src/toolkit/provider.js` | JSDoc typedef for `AccessibilityProvider` (`init`, `getStatus`, `getProfile`, `saveProfile`, `getSurfaceSettings`, `capabilities`) and `assertProvider` |
| `src/toolkit/standalone-provider.js` | v0 default. All seven capabilities are `false`. Profile comes from our own prefs. Status is `{ mode: "standalone", integrated: false }` |
| `src/toolkit/toolkit-integration.js` | The only module that constructs a provider. `getProvider()` is initialised once per service worker start. Holds the commented placeholder for `createToolkit({ ports })` |

## What changes when the toolkit is added

1. Install the toolkit package (the only dependency added).
2. In `toolkit-integration.js`, replace the placeholder with the real `createToolkit({ ports })` call. Supply `KVStore` (wrapping `chrome.storage.local` under a namespace separate from `pws.`), `Clock`, `Scheduler`, `Consent` and the actuation port. Wrap the result in a provider that satisfies `AccessibilityProvider`, falling back to the standalone provider for anything not supplied.
3. Flip the relevant `capabilities` to `true` only for what is truly provided. The footer then reads the real mode from `getStatus()`.
4. Surface adaptation consent in the side panel through a validated message and its own module.
5. Optionally replace the own text-size setting with the toolkit's surface renderer, and feed its auditors into the page audit.

Nothing in `src/workflow/`, `src/safety/`, `src/commands/`, `src/content/` or the side panel needs to change.

## Hard rules (enforced by `tests/build.test.js`)

- The side panel and content script never import toolkit code. Only the service worker touches the provider. The panel asks for status through a validated message (`pws/get-status`).
- The footer truthfully reads "Toolkit: not integrated (standalone mode)". It is built from `getStatus()`, never hard-coded success.
- Toolkit consent for adaptations and our transaction confirmation live in **separate modules that share no code or state**. `src/safety/` imports nothing from `src/toolkit/`, and the reverse.
- No language model, now or later, may authorise, initiate or override a consequential action.
