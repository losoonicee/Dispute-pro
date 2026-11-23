DISPUTE STUDIO AI 5.0 — TWO OPTIONS

A) PRIVATE LOCAL REPORT READING (works on your existing GitHub Pages website)
Upload PDF/screenshots/TXT. The Reader extracts text on your phone, explains entries with its rules, reads the explanations aloud, and lets you review before importing fields into client cases. Real credit reports use varying layouts; always check the originals and correct OCR errors. All original local features remain.

B) CONNECT REAL OPENAI AI ANALYSIS (requires Vercel plus an OpenAI API account)
GitHub Pages is static; it CANNOT run a private AI API function or securely store an OpenAI API key. You cannot turn on real OpenAI analysis just by uploading static files to GitHub Pages. You need a backend deployment.

1. Upload the FULL app package (including the api/analyze-report.js folder) to a PRIVATE source repository or import the project into Vercel. Keep the existing public GitHub Pages copy for local-only reading, if you prefer. No real credit report should EVER be committed to GitHub.
2. On Vercel, create a project from the repository, with framework setting "Other", and deploy.
3. In Vercel Project Settings > Environment Variables, set:
     OPENAI_API_KEY  = your actual OpenAI API key (server-side secret, NEVER in index.html or GitHub)
     AI_ACCESS_CODE = a long unique access phrase you choose (at least 16 random characters recommended)
     ALLOWED_ORIGIN = https://losoonicee.github.io,https://YOUR-VERCEL-SITE.vercel.app
     OPENAI_MODEL   = gpt-4o-mini (optional)
   Never send an API key, access code, or private credit report in a ChatGPT message. You will configure them yourself in Vercel.
4. Redeploy after setting environment variables. Vercel should serve /api/analyze-report.
5. In Dispute Studio Reader, enter https://YOUR-VERCEL-SITE.vercel.app/api/analyze-report in "Your AI backend URL" and your AI_ACCESS_CODE in the private access-code field.
6. Upload a report or paste text, tap "Prepare private AI text", INSPECT/EDIT THE TEXT (redaction is best effort), tick consent, then tap "Analyze with AI" or ask a question. You may optionally choose up to two image previews per AI call; raw screenshot images may still show sensitive details. Additional screenshots can be analyzed in separate batches.
7. Review AI findings against actual reports and supporting records. AI does not directly file disputes or auto-add alleged errors to a letter. Its findings must be imported to the Reader and manually reviewed first.

PRIVACY & SECURITY
- This app is not suitable for storing full client identity documents or unencrypted sensitive reports. Do not store SSNs, credentials, full credit card numbers or other secrets in client notes.
- Do not paste real client reports without their authorization; the AI service sends only approved text/images to your backend and then the configured OpenAI API.
- Browser local storage is not encrypted. The access code lives in memory only for the current page session. The backend is guarded by that code and allowed origins, not by individual user authentication; for commercial use add account authentication, rate limiting, authorization records, a vendor/data processing review, and a data retention policy before onboarding clients.
- The free local Reader remains available when the AI service has no credentials or is unreachable. AI usage may incur OpenAI API/Vercel costs.

FOR YOUR EXISTING GITHUB PAGES APP
The UI files to replace are: index.html, styles.css, report-reader.js and sw.js. Upload them at the repo ROOT, NOT a nested folder. Commit changes. Reopen the iPhone Home Screen web app while online to refresh the cache. Existing case data format is unchanged; export a backup BEFORE updating. You will only have local rule-based reading until the separate AI backend is deployed/configured.

IMPORTANT: AI does not automatically prove legal inaccuracies, identity theft, FCRA violations, or credit deletion rights. Check each reported fact, document discrepancies, and keep user approval before writing or sending letters.
