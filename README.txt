DISPUTE STUDIO 3.0 — COMPLETE iPHONE WEB APP
==========================================

THIS IS THE COMPLETE WEBSITE, NOT AN UPDATE PATCH.

WHAT'S INCLUDED
• Client profiles and multiple reporting items per client
• Report Reader: PDFs, screenshots, multiple images, TXT and pasted report text
• Text PDF extraction (PDF.js) and scanned page OCR (Tesseract.js), run locally in your browser
• Voice explanations: "Read it to me", "Explain all", and individual account listening, with speed settings
• Review explanations: collection, charge-off, payment history, balances, account dates, utilization
• Suggested routes for investigation, including validation requests, bureau disputes, and goodwill requests
• CORRECT OCR FIELDS before importing to case — name, masked account number, balance, limit, status, dates, bureau, type
• Your Insight text box, supporting records and an explicit verification checkbox
• Autofill client info, account details, case notes, and reviewed dispute letter drafts
• Seven letter workflows, printable PDF packets, signature canvas, bureau/collector route, deadline tracking
• Evidence Vault for screenshots and PDF attachments; separate profiles
• Offline cache and Home Screen app, including top Dynamic Island safe-area spacing
• Backup and restore of local saved data

PUBLISH IN GITHUB (on your iPHONE)
1. Export a FULL BACKUP from the existing app Settings if you have any client data. Do not delete the Home Screen app.
2. Unzip this ZIP using Files on your iPhone. You should see the individual website files.
3. Open GitHub repository > Add file > Upload files. Upload ALL website files directly at repository ROOT, not a parent folder and not the ZIP itself.
4. GitHub may ask you to replace existing files. Keep each filename exactly the same. Tap Commit changes.
5. Go to Settings > Pages > Build and deployment > Deploy from a branch > main > /(root), if not already enabled.
6. Open the live GitHub Pages URL in Safari. The installed app updates via its offline cache on subsequent launches. Fully close and reopen while online.
7. Safari > Share > Add to Home Screen for a new installation. If you already installed it, do not delete the old icon as that could erase device-saved cases.

IMPORTANT
• This is a RULE-BASED reader, not a general AI assistant like Claude. It can miss accounts or OCR amounts. Verify every extracted item against the original report.
• A suggested "dispute path" is not proof of an error. Accurate negative information is generally not removed by a factual dispute just for being negative.
• The app does NOT submit disputes or contact bureaus automatically, and cannot guarantee outcomes. A dispute letter does not pause court deadlines.
• Saving is OFF by default. Turn saving ON if you want cases to persist on this device. Local storage is not encrypted.
• Do not store full SSNs, complete account numbers, passwords, or one-time codes.
• Never upload actual client reports or case backups to a PUBLIC GitHub repository.
• PDF.js/Tesseract.js runtime scripts are loaded from third-party CDNs as needed; first-time internet access is required for PDF/OCR functionality.
• Keep separate client profiles and obtain authorization before processing another person's financial data.

FILES
index.html, app.js, report-reader.js, styles.css, sw.js, manifest.webmanifest, icon.svg, icon-192.png, icon-512.png, README.txt
