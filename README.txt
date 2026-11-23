DISPUTE STUDIO — iPhone-first credit case workspace
Version 1.0 | November 2026
========================================

WHAT'S IN THIS APP
- Five-tab iPhone-first design: Home, Cases, Letters, Evidence, Learn.
- Unlimited client profiles and multiple credit-report items for each profile.
- A fictional, prefilled Alex Morgan example.
- Collection, charge-off, late-payment, inquiry, personal-information,
  repossession, public-record and other reporting categories.
- Specific-error checklists, collector validation questions and document checklist.
- Live letter drafts for Experian, Equifax, TransUnion, debt collectors,
  direct furnishers, goodwill, identity theft, personal information and inquiries.
- Separately confirmed bureau/collector letters, plus a ready-letter PDF packet.
- Draw-your-own finger signature (never saved in the browser or in a case code).
- Download or iPhone-share PDFs, copy letter text, and print.
- Multiple image and PDF attachments per item; no built-in file count cap.
  Actual limits are your browser's storage quota and device free space.
- Optional local device saving (OFF by default), full JSON backup including
  attachments, JSON restore, case code for transferring one profile.
- Legal education, official bureau submission links, and timelines.
- Installable offline-friendly Progressive Web App (PWA) when hosted over HTTPS.

HOW TO INSTALL ON YOUR iPHONE
The ZIP is an actual website, not an App Store IPA. To install it as a Home
Screen web app, first publish the files at a secure HTTPS URL. GitHub Pages
is one free option:

1. Download dispute-desk-studio.zip to your iPhone's Files app.
2. Tap it to unzip. Inside the folder you'll see index.html, app.js,
   styles.css, the icons, manifest.webmanifest and sw.js.
3. In Safari, go to https://github.com and sign in (or create an account).
4. Create a NEW PUBLIC repository, such as 'dispute-studio'. A public
   GitHub Pages repository exposes the app's CODE, not its local case files.
5. Use 'Add file' > 'Upload files' to upload ALL files from the unzipped
   folder into the TOP LEVEL (root) of the repository. Commit changes.
6. In repository Settings > Pages, select 'Deploy from a branch', then
   the 'main' branch and '/ (root)' folder. Save.
7. Open your Pages address in Safari, typically:
       https://YOUR-USERNAME.github.io/dispute-studio/
8. From Safari, tap Share > Add to Home Screen; if offered, select
   'Open as Web App'. Add it, then open the new icon.

The exact GitHub/iOS wording may change. You can also host the same files on
another reputable static HTTPS host. Keep file names and paths unchanged.
Opening index.html directly from the Files app may not provide reliable local
storage, offline installation or PDF behavior; hosting is recommended.

FIRST USE
1. Tap 'Explore example' to inspect the fictional workflow, or tap
   'New client / case' to create a blank client.
2. Select the client and the reporting account in Cases. Enter only the
   account's masked reference or last 4 digits (never the full number).
3. Select only factual errors supported by the person's records.
4. Go to Evidence to attach report screenshots and supporting files.
5. Go to Letters. Select a template and bureau, then review the live draft.
6. Fix missing fields; affirm that every statement is true; draw a signature.
7. Save/Share PDF or use the packet builder for multiple ready letters.
8. Submit separately at each official bureau/collector site or by mail.
   The app NEVER submits, sends, signs, or contacts anyone automatically.
9. Record actual delivery dates and compare results with the source records.

PRIVACY & BACKUPS
- Saving is OFF at startup. With it OFF, refreshing/reloading clears the case.
- With saving ON, cases are stored in the browser localStorage and evidence
  is stored in IndexedDB. THIS STORAGE IS NOT ENCRYPTED.
- The app has no backend, login, server-side storage, sync or analytics.
- Export full backups regularly, especially before clearing browser data,
  using another phone, or changing the website's URL. The backup is plain text
  plus encoded attachments, NOT ENCRYPTED. Protect it like client records.
- A signature exists in memory only; it is not saved after reload, case code
  transfer or backup, and must be drawn again when needed.
- Case code transfers profile and item details but NO files or signatures.
- The live site is public code. Any data you type into a browser stays only
  on that device unless you deliberately export or share it.
- Do not enter SSNs, dates of birth, government ID images, passwords, security
  answers, one-time codes, full account numbers or high-risk confidential data.
- For professional client use, implement an appropriately secure system,
  authorization/contract workflows, records policies and regulatory compliance.

IMPORTANT
This is an organizational/educational tool; it does not guarantee
corrected/deleted credit entries or perform legal representation. Accurate
negative items aren't automatically removed by disputing. A debt collector
validation process differs from credit-bureau reinvestigation. A dispute
letter does not pause a lawsuit response deadline. Only assert identity theft
if it actually happened and the supporting documents are accurate.

LINKS
Experian: https://www.experian.com/help/dispute-credit/
Equifax: https://www.equifax.com/personal/credit-report-services/credit-dispute/
TransUnion: https://www.transunion.com/credit-disputes/dispute-your-credit
Credit reports: https://www.annualcreditreport.com/
FTC identity theft: https://www.identitytheft.gov/
CFPB bureau investigation timing:
https://www.consumerfinance.gov/ask-cfpb/how-long-does-it-take-to-repair-an-error-on-a-credit-report-en-1339/
CFPB collector disputes:
https://www.consumerfinance.gov/ask-cfpb/can-a-debt-collector-still-collect-a-debt-after-ive-disputed-it-en-338/

This is an independent original implementation and is not affiliated with,
endorsed by, or connected to Claude, Experian, Equifax, TransUnion,
or McKenzie Adams Credit Repair.
