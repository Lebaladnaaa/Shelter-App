# Shelter Surveys – developer notes (1.8)

No build step and no framework: plain JavaScript you can edit directly.

```
Phone / PC (PWA, offline-first)                     Google (owned by the admin account)
┌───────────────────────────────┐   POST JSON    ┌──────────────────────────────────────┐
│ index.html  app.js  app.css   │ ─────────────▶ │ Apps Script web app  (Code.gs)       │
│ sw.js  (offline cache)        │   text/plain   │   doPost → auth_ → action            │
│ IndexedDB: surveys, files,    │ ◀───────────── │ Google Sheet (tabs = tables)         │
│            meta (queues)      │                │ Drive folder (paper photos only)     │
└───────────────────────────────┘                └──────────────────────────────────────┘
```

## Files

| File | What it is |
|---|---|
| `app/app.js` | The whole app, in one IIFE. Sections are marked `/* ═══ … ═══ */`: data and wood maths, roles, local DB, sync, screens (welcome, list, editor steps, days, my houses, dashboard, users, settings), exports (PDF via jsPDF, PowerPoint via PptxGenJS, PNG), events, boot. |
| `app/sw.js` | Service worker. Caches each file on its own. Pages and `config.js` go network-first; everything else is cache-first with a background refresh. **Change `VERSION` on every release.** |
| `app/config.js` | `apiUrl`: the `/exec` link. It takes priority over the link saved on a phone. |
| `app/index.html` | Shell, with a strict Content-Security-Policy (`script-src 'self'`, no eval, connect only to `script.google.com` / `script.googleusercontent.com`). |
| `app/jspdf.umd.min.js`, `pptxgen.bundle.js`, `qrcode.js` | Vendored libraries (MIT), loaded on demand for exports. |
| `apps-script/Code.gs` | The server: every action, all permission checks, the sheet layout, `setup()`, and the sheet menu. |
| `tests/` | `mock-gas.js` runs the real `Code.gs` in Node with in-memory Sheets/Drive/Cache/Lock/Mail. There are four unit suites (`auth_test.js` for accounts), plus `e2e16.py` (Playwright, five roles and extra phones on separate browser contexts). |

## Data

Each tab is a table. The **Surveys** row is for humans. The source of truth is the JSON in *Data (app use – do not edit)*. Server-owned fields in that JSON: `createdById, researcher, reviewer, approvedBy, taskId, day, leaderId, leaderName, roofedAt, roofedBy, teamId`. A phone can't set them; `saveSurvey_` copies them from the stored row.

Rooms carry `notes` and `walls: { t, r, b, l }` (each `door | window | both | entrance`, as drawn on the plan; turning a room on the plan turns its walls clockwise; one `entrance` per house). The sheet writes *Doors*, *Windows*, *Room notes* (Rooms tab) and *Entrance* (Surveys tab).

Local (IndexedDB `shelter`): `surveys` (with `dirty` / `base` for sync), `files` (paper blobs), `meta` (`me`, `lastPull`, and the offline queues `pendingDeletes`, `pendingStates`, `pendingTasks`, `pendingPhotos`, plus cached `tasks`, `leaders`, `users`, `photos`).

Sync order (`syncNow`): identify if needed → deletes → surveys → papers → roofed marks → days → photos → pull (incremental, `since` = last server time; equal timestamps are re-sent on purpose).

## API (`doPost`, JSON body, `Content-Type: text/plain` to avoid CORS preflight)

Every signed-in request carries `uid` + `token` (the phone's session key), plus `v` and `deviceName`. `signup`, `login`, `resetRequest` and `resetPassword` carry no identity. Old phones may still send `key` (team code or a first-time admin code) until they set a log-in.

| Action | Who | Notes |
|---|---|---|
| `signup` | anyone with the team code | `teamCode, name, username, pass, email?` → `{me, token}`. Starts as Researcher (`Waiting` if *New people need approval* = Yes). |
| `login` | anyone | `username, pass` → `{me, token}`. Same answer for an unknown username and a wrong password; 5 wrong in 15 min lock the username (`locked`). |
| `resetRequest` | anyone | `username` → emails a 6-digit code (15 min, 5 tries) if the account has an email. Same answer either way; 3 per username per hour. |
| `resetPassword` | anyone with a code | `username, code, pass` → new password, every other session ended, `{me, token}`. |
| `setLogin` | a session from before 1.7 or a first-time admin code | `username, pass, email?` once; the old phone key becomes a hashed session, the admin code is cleared. |
| `changePassword` / `saveMe` / `logout` | signed in | `oldPass, pass` (other sessions end) / `email` / ends this session. |
| `issueReset` | Manager (Researcher, Team leader), Admin (anyone but self) | `id, username?` → one-time code for 24 h; `username` gives one to someone from before 1.7. |
| `mergeUser` | Admin | `from, into`: surveys (`createdById`, `leaderId`, `teamId`, names), days (`leaderId`, `houseLeaders`), photos, sessions, the log-in if `into` has none, the higher role. `from` → `Active: No`, `mergedInto`. |
| `ping` | signed in | Who am I (`me.hasLogin` false → the app asks for a username once). An app from before 1.7 with the team code and `name` and no session still registers (no log-in yet). |
| `pull` | approved users | All surveys except other people's **drafts** (incremental; a survey that went back to Draft is sent in `deleted` with `hidden: true`); `tasks` for managers, and for team leaders only the days they're in; `users` + `teamCode` for managers (emails for admins only). |
| `saveSurvey` | Researcher / Team leader until approval; Manager always | The server clamps status changes per role (`STATUS_BY_ROLE`). **Location rule:** a survey with no location can't leave Draft (`needLocation: true`); once out of Draft, `locationCleared` is ignored. **Beam rule:** a room whose beam side + *Add for beams* exceeds the longest beam is invalid (`calcWood().invalid`) and can't leave Draft (`needWood: true`). |
| `uploadFile` / `getFile` | as above / approved | The type is decided by magic bytes (JPEG, PNG, WebP, PDF only). |
| `deleteSurvey` | own and not approved; Manager any | A copy goes to Deleted and to History. |
| `saveTask` / `deleteTask` | Manager | `houseLeaders: {surveyId: leaderId}`; only approved houses; one day per house. |
| `setHouseState` | the house's team leader (its own, else the day's), Manager | Sets `roofedAt / roofedBy / teamId`. |
| `saveUser` | Admin | Let in / refuse (`active`), role (`Researcher`, `Team leader`, `Manager`; admins only in the sheet), name. |
| `getHistory` | Manager, Admin | One survey's changes, newest first (max 60): `{id, time, who, role, device, action, changes, before, after, canRestore}`; `before`/`after` are the survey objects. |
| `recentChanges` | Manager, Admin | Latest 40 survey changes (scans the newest 400 History rows), no copies. |
| `restoreVersion` | Manager, Admin | `changeId` → saves the History row's *Before* copy back through `saveSurvey_` (logged as *Restored a version*, never merged, with that version's reviewer/approver). Not for *Deleted* rows. |
| `addPhoto` / `photos` / `deletePhoto` | approved (roof: team leader of that house or Manager; team: team leader) | JPEG only, at most 48,000 base64 characters (one cell). Stories expire after 7 days, 5 each. `photos` skips images listed in `have`. |

Errors come back as `{ ok:false, error, message }`: `bad_key`, `need_login`, `pending`, `blocked`, `not_allowed`, `busy`, `too_large`, `bad_file`, `deleted`, …

## Wood maths (`calcWood`, same in app.js and Code.gs)

Beams: one piece, `beamSide + beamAllowance` (Settings *Add for beams (cm)*, default 30) rounded up to the Wood rules; over the longest → `row.invalid`, a warning, no beams counted. Planks: `plankSide + allowance` (*Add for walls (cm)*, 10); over the longest → two halves meeting on the middle beam (beam count made odd).

## Data reset marker

`DATA_EPOCH` (Script Properties) is sent in `config.dataEpoch`. Phones store it; when it changes (Shelter → *Start fresh*, or a new sheet) they clear surveys, files, queues, days and photos, keep the log-in, and pull in full. Phones send `epoch` with every request; the server answers `data_reset` to anything but `ping / pull / logout / photos / getFile` from an older epoch, so old data is never uploaded into a fresh sheet. *Show / Set the account key* copies `LOGIN_PEPPER` to a copied sheet so the Users tab's hashes keep matching.

## Security model

- **Identity (1.7):** username + password. The app derives `pass = PBKDF2-SHA256(password NFKC, salt "shelter-surveys:" + username, 600,000 rounds, 256 bits)` with WebCrypto and sends only that (64 hex). The sheet stores `HMAC-SHA256(pepper, "pw:" + salt + ":" + pass)` with a random 128-bit salt per person; the pepper is in Script Properties (`LOGIN_PEPPER`, made by `setup`), never in the sheet. Sessions: 48 random hex characters per phone, stored as HMACs (max 10 per person). Reset codes: 6 digits, stored as HMACs, 5 tries. All of it lives in the hidden *Log-in* column as JSON; none of it is ever sent to a phone.
- **Old phones:** the 1.5/1.6 phone key (hidden *Phone key* column) and first-time admin codes still authenticate until `setLogin`, which moves the key into the hashed sessions and clears both. `resetPassword` also clears them.
- **Joining:** the team code + name + username + password makes an account as Researcher straight away (`Active: Yes`). Admins raise roles and switch people off. The optional Settings switch *New people need approval* (default **No**) makes new accounts `Active: Waiting`; waiting users can only `ping` and `logout`.
- **If the pepper is lost** (Script Properties cleared), every password stops matching: a new pepper is made, and people reset with a code (managers, or Shelter → Reset someone's password).
- **Brute force:** each wrong code, password or reset code sleeps 1.2 s, or 4 s after 30 in 10 minutes (CacheService); 5 wrong passwords lock a username for 15 minutes; usernames can't be discovered through `login` or `resetRequest`. New accounts are capped at 500 per hour (a flood guard, not a team limit). The app refuses short and common passwords and ones too close to the username.
- **Authorization:** every rule is enforced in `Code.gs` (`canEdit_`, `canDelete_`, `STATUS_BY_ROLE`, per-action checks). The app's own checks only shape the UI.
- **Sheet formula injection:** `cellSafe_` prefixes `'` to any written string starting with `= @ \t \r`, or with `+` / `-` not followed by a digit (applied in `rowFrom_` and in every direct `setValue` of user text).
- **Files:** content-sniffed allowlist on upload and download; file names stripped of path/control characters; the app opens only `image/*` and PDF blobs.
- **App:** CSP; every dynamic string goes through `esc()`; `cleanApi` accepts only `https://script.google.com/macros/s/…/exec` (so a crafted invite link can't redirect data); `rel="noopener noreferrer"` and `referrer: no-referrer`.
- **Audit:** History rows (who, role, device, app version, diff, JSON before/after, `Change ID`), the Deleted tab, and Drive trash for 30 days. One person's edits to one survey within 15 minutes (same action, no status change in the save) are merged into one row: *Before* stays the copy from before they started. Restores are never merged.
- **Restore:** the restore marker is a fourth argument to `saveSurvey_`, set only by `restoreVersion_`; nothing in a request body can trigger it.
- **Sheet protection (`protectTabs_`, run by `setup`):** History and Deleted are protected so only the owner can edit; the data tabs get warning-only protection. The web app runs as the owner, so the app is unaffected.
- **No deletion paths:** no action deletes tabs or the file. Rows are deleted only by `deleteSurvey` (own + not approved, or Manager), expired stories, and replaced roof/team photos.
- **Known limits:** anyone with the team code can make an account as a Researcher (and sees all surveys, national IDs included), so keep the code inside the team and change it when people leave; switch off unknown names in Users. Email codes come from the script owner's Gmail (100 a day on a normal account). The web app must be "Anyone" (no Google login on phones). A stolen unlocked phone has that user's access until an admin switches it off. Data on the phone (IndexedDB) isn't encrypted; *Reset this phone* clears it.

## Run the tests

```bash
cd tests
node auth_test.js && node launch_test.js && node roles_test.js && node backend.test.js && node delete_test.js   # server, about 2 s

# browser, end to end (needs: pip install playwright && playwright install chromium)
(cd ../app && python3 -m http.server 8000) &
node mock-gas.js ../apps-script/Code.gs 8001 &      # first-time admin code begad-0001, team code Shelter-2027; GET /__mail = sent emails, /__fresh = Start fresh
python3 e2e16.py 8001                                 # screenshots in tests/shots/
```

For the browser test, `config.js` must have `apiUrl: ''` (the test passes the fake sheet's link in the URL). The app's CSP only allows `script.google.com`, so the test opens its browsers with `bypass_csp`; the app also accepts `http://localhost` links only while it is itself served from localhost.

## Release checklist

1. Bump `APP_VERSION` (app.js), `VERSION` (sw.js) and `SHEET_CODE_VERSION` (Code.gs).
2. Run all tests.
3. Deploy the **sheet first** (paste, run `setup`, Manage deployments → New version), **then** upload the app files. The new app expects the new server; old apps keep working against the new server until they update, which happens on their next online open (1.5+ restart into the update by themselves; the service worker reloads pages from older versions).
