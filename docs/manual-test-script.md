# Manual test script (with the co-designer)

Purpose: find out what automated tests cannot. This is a conversation, not an exam. The extension is being co-designed with a blind screen-reader user, so every answer below is a finding, not a pass or fail.

## What automated tests cannot prove

- Whether announcements are understandable, well timed and not too chatty for a real screen reader.
- How the panel behaves with the person's own screen reader, browser, speech rate and braille display (NVDA, JAWS, VoiceOver, TalkBack, and so on).
- Whether focus moves feel predictable, including after Chrome re-renders the side panel.
- Whether the wording ("sensitive, not checked", "needs your confirmation") builds trust or causes worry.
- Whether the confirmation steps feel safe or tedious.
- Anything on real government sites, which differ from the demo.

axe-core and the unit tests are necessary, not proof.

## Before you start

1. Build and load the extension (`README.md`), pin it, and run `npm run demo`.
2. Ask the co-designer which screen reader, browser and device they use. Note them.
3. Remind them: fake data only, nothing real is paid, and they can stop at any time.
4. Suggested fake data: any name, ID `12345678`, phone `+254712345678`, any date, permit `PN-12345`, any 6 digits for the code, card `4111111111111111`, code `123`.

## Script

For each step, note what they said, where they hesitated, and anything the screen reader read twice or not at all.

**A. Open the panel**
1. Open `http://localhost:4173/` and press Start application.
2. Open the panel with the toolbar icon. Where does the screen reader focus land? Is it clear what the panel is?

**B. Basic commands**
3. Type `help`. Is the list useful? Too long?
4. Type `where am I`. Is the summary what they would want first?
5. Type `list fields`. Is "filled or empty, never the value" clear? Is anything missing (hints, errors)?
6. Type `go to phone`. Does the screen reader announce the page field and the panel's message in a way that is not confusing? Is it a problem that both speak?
7. Type `next` a few times. Does the order feel right?
8. Type something unknown. Is the error helpful?

**C. Errors**
9. Open `http://localhost:4173/personal.html?error=1`. Run `where am I`. Is the error found and read clearly?

**D. Sensitive fields**
10. Continue to the review step. Ask them to find the verification code field using the extension, then type the code themselves on the site. Did they feel the extension stayed out of the way? Was "I cannot see it" reassuring or annoying?

**E. Submission**
11. When the review area appears, does focus move to its heading? Is the summary what they would want to hear before submitting?
12. Press Confirm submission, then Submit application now. Is two steps right, too many, or unclear?
13. Before sending, change something on the page. Is the "confirmation is no longer valid" message noticed and understood?

**F. Payment and receipt**
14. On the payment step, are recipient, amount, fees, total and purpose clearly read? Do they want anything else (currency spoken, order)?
15. Type the fake card details on the site themselves. Confirm and pay.
16. Run `read receipt`. Is the receipt usable? What would they want to save or copy?

**G. Settings**
17. Try minimal announcement detail, a larger text size, and read-back on request. Do they understand what read-back does and where the data goes?

**H. Another website**
18. On a site they know, open the panel and try `where am I`, `list fields`, `go to`. How well does it find labels? Which fields are not found?

## Questions to close with

- What was the most confusing moment?
- Which message would you remove, shorten or reword?
- Did you ever worry it might do something you did not ask for?
- What would you still ask a person for help with?
- Which real service and step would you test next?

## Record

Screen reader and version, browser, device, date, observers present, and every issue with the step number. Keep recordings only with explicit consent.
