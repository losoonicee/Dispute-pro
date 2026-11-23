DISPUTE STUDIO 12 — ACCOUNT-FIRST READER

FIXED: Screenshot fragments no longer become separate accounts. The Reader consolidates matching creditor + account last four across screenshots and bureaus, while keeping bureau-specific balances/status/dates and source files separate. Uncertain OCR fragments do not become auto-importable accounts.

NEW: account-level repair workflow, field differences, per-bureau dispute selection, evidence notes, and one-click import into the letter review screen.

Install: replace index.html, report-reader.js and sw.js in the ROOT of your existing GitHub repository (not inside a folder). Keep all other files as-is. Back up cases first. Load the site online once after updating so the service worker refreshes.

No files with your private notes, credit reports or API key are included. AI backend configuration remains untouched.

Limitations: on-device OCR can still misread small text. Verify every field against the original screenshot and identify a specific real error before sending any letter. Different bureaus can legitimately differ by date.
