DISPUTE STUDIO 11 — FREE READER REPAIR

This update is for your existing Dispute-pro GitHub Pages app. It keeps your current
Knowledge Vault, imported private notes, letters, clients, Deep Desk, offline Dispute Desk 2,
and optional paid OpenAI backend. It does NOT include any private credit-report notes.

WHAT CHANGED
- Free screenshot OCR now receives the ORIGINAL uploaded image instead of the compressed
  image created for the optional paid AI API.
- Standard local OCR is attempted first. If it fails or yields an incomplete account,
  the bundled offline OCR engine is tried as a fallback. No OpenAI API credits needed.
- Actual recognized text is shown above the case results. You can correct it and
  tap "Extract accounts from this text" to re-run the parser without re-uploading.
- An explicit error message appears when OCR cannot process an image.
- Manual account entry remains available when a screenshot is unreadable.
- Free scan and results now appear before the long Knowledge Vault and paid AI settings.
- OCR edits and manual notes are recorded only when you have unlocked your private vault.
- iPhone Live Text paste remains a free alternative.

INSTALL FROM IPHONE
1. Export a case backup from the current app first. Do not delete the Home Screen app.
2. Unzip dispute-studio-v11-iphone-update.zip using iPhone Files.
3. Upload the five replacement files (index.html, app.js, report-reader.js,
   styles.css, sw.js) into the ROOT of losoonicee/Dispute-pro, replacing existing versions.
4. Commit changes. Open the live site while online to update the Home Screen cache.
5. Reader > Read screenshots FREE > select a screenshot.
6. Inspect "What the Reader actually recognized" and correct OCR errors before importing.

LIMITATIONS / SAFETY
- The Reader uses OCR + deterministic parsing, not a free replacement for vision AI.
- Bureau report layouts vary, and OCR may miss small print or columns. Confirm every
  account, balance, status, and date against the actual report.
- Never create a dispute allegation based only on an OCR guess.
- Tesseract.js is fetched from a third-party CDN when online; recognition is local.
  The bundled offline engine can work without network once cached.
- This build passed JavaScript syntax and simulated parser/field-review tests, plus
  a bundled OCR model test on a fictional report. It was NOT tested on a physical iPhone.
- The user's existing Vercel backend/API credentials were not changed.
