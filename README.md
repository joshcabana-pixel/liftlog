# Lift Log

Personal lifting tracker (PWA). No build step — static files, data in browser storage.

**Deploy:** push to GitHub → Settings → Pages → serve from main branch root. On iPhone: open the URL in Safari → Share → Add to Home Screen → "Restore from a backup file" and pick your history backup (kept in iCloud/Files — **personal data is never committed**; `data/` is gitignored).

**Test (required before any release):** needs a local `data/seed.json` (your history, not in the repo).

```
npm install
npx playwright install chromium   # once
npm test                          # must print "✅ … 0 failed"
```
35 checks: every screen, log/undo/skip, persistence, decimal weights, exercise rename with planned sets, meso creation & ordering, CSV import run twice (second must add 0), backup export→erase→restore, empty-data start, storage-full handling.

**Sheet import:** Google Sheets → Log tab → File → Download → CSV → Settings → "Import sets from the Google Sheet".
