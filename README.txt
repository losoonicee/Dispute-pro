DISPUTE STUDIO AI 7 — IPHONE CASE WORKSPACE

This release combines the original Deep Dispute Desk with the Studio workflow and the new, review-first three-bureau comparison.

FEATURES
- On iPhone, upload credit-report screenshots, PDF pages, or text from an authorized consumer.
- Local PDF text extraction, optional local OCR (requires first-load CDN), optional consent-based AI vision via the separately deployed Vercel backend.
- Batch scan multiple images (2 images per AI request); voice read-aloud explains each account; private access code must be entered per session.
- A three-bureau comparison matrix shows each report's values separately without assuming discrepancies are errors.
- Source image buttons let the consumer cross-check the AI transcript against the uploaded image previews.
- Auto-fill reviewed consumer and account details into separate local case profiles. Accounts with different last-four references are not automatically combined.
- Letter Studio has bureau-specific source values; multi-bureau cases require a separate, explicitly described factual dispute per bureau before a letter can be marked ready.
- Finger signatures, PDF export, original Deep Desk, evidence vault, timelines and manually recorded bureau outcomes.

UPDATE WITHOUT DELETING YOUR HOME SCREEN APP
Use the small five-file iPhone update ZIP if your live GitHub repository already contains the full Studio app and Deep Desk page. Back up your local case data first.
Upload index.html, app.js, report-reader.js, styles.css, sw.js into the repository root, replacing existing files. Commit, let GitHub Pages update, then close/reopen the iPhone Home Screen app while online. Do NOT delete the app icon; that could remove its local case storage.

FIRST-TIME NEW SITE
Upload all files in this ZIP to your site's repository root. Publish with GitHub Pages main / (root). The Vercel API backend is a separate deployment and is not embedded here.

PRIVATE AI BACKEND
Endpoint: https://dispute-studio-ai-backend.vercel.app/api/analyze-report
The OPENAI_API_KEY is a private server-side Vercel Secret. Do not put an API key in GitHub or the app. The app asks for the separate AI_ACCESS_CODE, which stays in session memory. The backend must be deployed and configured separately. API usage can incur charges. The AI analysis workflow was tested with mock model responses; real account scanning still requires device and service testing.

IMPORTANT SAFETY
The demo has fictional financial data. Local case storage and backups are not encrypted, and this software is NOT ready for multiple paying clients, shared accounts or regulatory certification. Never upload private client data into public GitHub. Obtain authorization and verify all extracted facts. Disputes must be truthful and supported by evidence. Actual negative information is not necessarily inaccurate. The app does not send disputes or override court deadlines. Commercial use requires appropriate hosting and legal/security review.
