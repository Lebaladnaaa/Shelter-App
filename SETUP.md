# Shelter Surveys – setup and install guide

Lebaladna Shelter team · survey app for roofing · version 1.8

**What it does:** researchers record each house on their phone: the family, every room's beam side and plank side, a plan they arrange by dragging rooms, the house location, and photos of the required papers (National ID, etc.). It works without internet and uploads to a Google Sheet when the phone is back online. Managers approve houses and plan implementation days, each house with its own team leader. For implementation day it exports a PDF, an editable PowerPoint or a drawing image with the colored plan, beam direction, room sizes, wood lengths and a QR code to the house, plus the purchase list (`420 × 7` = 7 pieces of 420 cm). A dashboard ranks the teams and shows roof photos and team stories.

**What's in the package**

| Folder / file | What it is |
|---|---|
| `app/` | The phone app: **16 files, no subfolders**. They go on a free website (Part 2). |
| `apps-script/Code.gs` | The database code. Goes into your Google Sheet (Part 1). |
| `SETUP.md` | This guide. |
| `DEVELOPER.md` | How the code is built, the API, the tests, the security design (for programmers). |
| `tests/` | Automated tests: the real sheet code in a fake Google, and browser tests. |

---

## Part 1 – Set up the Google Sheet (admin, once, about 10 minutes)

1. Sign in to the Google account that should **own the data**. A shared team account (for example a Shelter Gmail) is better than a personal one. Every survey and every photo will live in this account.
2. Create a new Google Sheet and name it, for example, **Ismailia Surveys**.
3. In the sheet, open **Extensions → Apps Script**. Click in the code, press **Ctrl+A** then **Delete**, so the editor is completely empty. The sample `function myFunction() { }` must go too: code pasted inside it won't work. Then paste the whole of `apps-script/Code.gs` and click **Save**. The first line must start with `/**`, not `function myFunction`.
4. In the toolbar, pick the function **`setup`** and click **Run**. Google asks for permission:
   - **Review permissions** → choose the account.
   - "Google hasn't verified this app" → **Advanced** → **Go to Shelter Surveys (unsafe)** → **Allow**.
   - This is your own script. It needs Sheets (to save surveys), Drive (to save paper photos) and Gmail sending (to email "forgot password" codes).
5. A pop-up shows the **first-time admin codes** for Begad and Hawary and the **team code**. Each admin uses their code **once**, to choose a username and password (Part 3). Keep them private. Refresh the sheet: you now have a **Shelter** menu and the tabs below. (Lost a code? **Shelter → Show users**.)
6. Deploy it as a web app: **Deploy → New deployment**, gear icon → **Web app**. *Execute as:* **Me**, *Who has access:* **Anyone**, **Deploy**, then copy the **Web app URL** (it ends in `/exec`). "Anyone" means people don't need Google accounts. Codes decide who gets in.
7. Test it: open the `/exec` link in a **private/incognito window**. It should say *"The connection works"* and show the version. If the link has `/u/0/`, `/u/1/` … in it, remove that part.

| Tab | What it holds |
|---|---|
| Surveys | One row per house: the survey database (with team leader and roofed time) |
| Rooms | One row per room, with the wood each room needs |
| Drawings | One row per house with its plan |
| Papers | One row per uploaded paper photo, with its Google Drive link |
| **Wood rules** | **Beam and plank lengths you can buy (Part 9)** |
| Settings | Team code, 10 cm for walls, beam spacing, plank width, default project (and an optional approval switch, off) |
| Required papers | The papers researchers are asked to photograph |
| Users | Everyone with an account: name, username, role, email, phone/PC, last seen. Passwords are kept only as protected hashes in a hidden column |
| Implementation days | One row per day: date, team leader, houses, roofed count, purchase list |
| History | Every change: when, who, from which phone, what changed, and a full copy **before** and **after**. Locked: only the sheet's owner can edit it |
| Photos | Dashboard photos, each shrunk to about 30 KB, kept inside the sheet (not in Drive) |
| Deleted | A copy of every deleted survey |

## Part 2 – Put the app online (once, about 10 minutes)

The app must be on an **https** website so phones can install it and use it offline. GitHub Pages is free and permanent.

1. Open `app/config.js` in a text editor and paste your `/exec` link between the quotes:
   `apiUrl: 'https://script.google.com/macros/s/…/exec'`
   Every phone uses this link. To move to a new link later, change it here once.
2. Create a free account at github.com, then **New repository**. Name it `shelter-surveys`, choose **Public**, and click **Create**.
3. Click **uploading an existing file**, select **all 16 files** in the `app` folder (Ctrl+A), drag them in, and **Commit changes**. The repository must list all 16 files, including `shelter-logo.png`, `icon-192.png`, `qrcode.js` and `jspdf.umd.min.js`.
4. **Settings → Pages** → *Source:* **Deploy from a branch**, **main**, **/ (root)**, **Save**. After a minute or two the app is live at `https://YOUR-NAME.github.io/shelter-surveys/`. Only the app's code is public. Survey data stays in your Google Sheet.
5. Open the link on your own phone and set up your log-in with your **first-time admin code** (Part 3). Then **Settings (gear) → Copy invite link** and send it to the team's WhatsApp group. The invite link already contains the team code, so people only choose their name, username and password.

## Part 3 – Install and log in

### Android
1. Open the invite link in **Chrome**, **Samsung Internet** or **Edge**. If WhatsApp opens it inside its own browser, tap ⋮ → **Open in Chrome**.
2. Tap **Install app** in the blue box, or Chrome's **⋮** → **Install app** (or **Add to Home screen**).
3. Open **Shelter** from the home screen and make your account (see *Logging in* below).

### iPhone
1. Open the invite link in **Safari** (on iOS 16.4 or newer, Chrome works too).
2. **Share** button → **Add to Home Screen** → **Add**.
3. Open **Shelter** from the home screen and log in **there**. The installed app keeps its own storage, separate from Safari. (Your account is the same everywhere: log in with your username and password.)

### PC (Windows or Mac)
1. Open the same link in **Chrome** or **Edge**, click the **install icon** at the right of the address bar, then **Install**.
2. Log in. The PC version is the same app on a wider screen.

**Logging in (1.7):** everyone has a **username and password**.

- **New account:** the invite link opens *New account* with the team code filled in. Type your **name** (the way the team knows you), choose a **username** (English letters or numbers, for example `ahmed.saad`) and a **password** (at least 8 characters; a short sentence is easy to remember). The **email** is optional: with it, you can reset a forgotten password yourself.
- **Log in again**, on the same phone or a new one: username and password. It's always the same account, with your surveys, role and team. Logging out and back in no longer makes a new user.
- **Begad and Hawary, the first time:** *Log in → Admin first-time code*, type the code from setup, then choose your username and password. The code then stops working.
- **Phones from before 1.7:** after the update, the app asks each person **once** to choose a username and password. Their account, surveys and role stay the same.
- The first log-in needs internet. After that the app works offline.

**No waiting.** A new account starts at once as a **Researcher**. Begad or Hawary then raise people to Team leader or Manager in **Users** (Part 4), and can switch anyone off.

### Forgot password
- **With an email on the account:** *Log in → Forgot password →* type your username → **Email me a code**. A 6-digit code arrives within a minute (check spam). Type it with a new password. It works for 15 minutes.
- **Without email:** ask a manager. In **Users** they tap your name → **Make a code** → **Send on WhatsApp**. Then *Forgot password →* your username, that code and a new password. It works for 24 hours.
- **Every admin forgot?** The sheet's owner: **Shelter → Reset someone's password** gives a code.
- A new password logs you out on your other phones. Nothing on those phones is lost; it uploads after you log in again.
- **Change password** or your **email** any time: Settings (gear).

**Every device:** open the app once **with internet** after installing. That first open saves everything needed for offline use.

## Part 4 – People and roles (admins)

| Role | Can do |
|---|---|
| **Researcher** | Records surveys. Reviews and corrects **any** survey until a manager approves it, and marks it reviewed. Deletes only **their own** surveys, before approval. Doesn't see the purchase list. |
| **Team leader** | Everything a researcher can, plus **My houses**: the houses a manager gave them, with the drawing, the way there and Roofed / Pending. |
| **Manager** | Approves surveys, plans implementation days, assigns each house to a team leader, sees and exports the purchase list, can change or delete any survey. Makes password codes for researchers and team leaders. |
| **Admin** (Begad, Hawary) | Everything a manager can, plus changing roles, switching people off, making password codes for anyone, and merging double accounts. |

In the app, open **Users**:

- **Change a role:** tap a person, then tap **Researcher**, **Team leader** or **Manager**. Their phone switches at its next sync. For example, make someone Team leader for a week, then set them back to Researcher.
- **Forgot their password:** tap them → **Make a code** → **Send on WhatsApp** (managers can do this too, for researchers and team leaders).
- **Same person twice** (two accounts from before 1.7): tap the extra one → *Keep this account:* choose the real one → **Merge into it** (tap twice). Their surveys, team houses, days and photos move over, the higher role is kept, and the extra one is switched off. Their phones keep working as the kept account.
- **Switch someone off:** tap them → **Switch off**. They can't use the app on any phone.

**Approval (off):** the **Settings** tab has *New people need approval*, set to **No**. Leave it. If you ever set it to **Yes**, new people wait on an *"Almost there"* screen until an admin taps **Let in** in Users.

**Someone left the team?** Switch them off. Changing the **Team code** (Settings tab) stops new accounts with the old code; existing accounts keep working.

## Part 5 – Researchers: using it in the field

1. **New survey** → five steps: Family · Rooms · Plan · Papers · Check & submit.
2. **Family:** tap **Save house location** at the door. **The location is required:** a survey can't be submitted (or approved) without it, and once submitted it can't be removed, only saved again. A warning appears if the same national ID or mobile was already surveyed.
3. **Rooms:** tap a name chip (Bedroom, Kitchen…), type the **beam side** (عروق) and the **plank side** (ألواح). Untick **Roof this room** for rooms that won't be roofed. You can type `345` for 3.45 m, or Arabic digits. **The beam side can be at most 5.70 m** (6 m beam − 30 cm for the walls): a longer one shows **Invalid** in red, with a **Swap beam and plank sides** button. Each room has its own **Notes** box.
4. **Plan:** **drag** rooms into place; they snap to each other. **Turn**, **Change beam direction**, **Line up rooms**. Tap a room, then under the plan choose for each wall (top, right, bottom, left, as drawn): **Door**, **Window**, **Door + window** or **House entrance** (one per house). They are drawn on the plan and in every export. **Save drawing** saves the plan as an image.
5. **Papers:** **Take photo** for each required paper. Only photos and PDFs are accepted.
6. **Check & submit:** a checklist shows anything missing. Tap the big green **Submit for review** button across the bottom. It won't go through without the house location or with an invalid beam side: the app takes you to what's missing.
7. **Not submitted = draft.** A draft shows an orange **"Draft – not submitted"** bar on every step, and **only you can see it** (not managers, not admins). Leaving it asks: **Submit for review**, **Save as draft and leave**, or **Keep editing**.
8. **Deleting:** on the Surveys list tap **Select**, tick the surveys, tap **Delete** twice. Only your own, not-yet-approved surveys can be deleted.
9. **No internet?** Keep working. The badge at the top shows how many changes are waiting. When there's signal, open the app and it uploads by itself.

### Reviewing
1. The Surveys list shows *"3 submitted waiting for review"*. Tap **Show them**.
2. **Search** by name, area, code, phone or national ID. Spelling differences are ignored (*احمد* finds *أحمد*).
3. Open the survey, fix anything, then **Mark reviewed** in the Status box.

## Part 6 – Managers: approving and implementation days

1. Open a reviewed survey → last step → **Approve**. After approval only managers can change it.
2. **Implementation days → New day:** name, date, **team leader** for the day.
3. Tick the approved houses. Each ticked house gets its own **Team leader** choice: it starts as the day's leader, and you can give it to another one.
4. The **purchase list** adds itself up while you tick. **PDF** / **PowerPoint** give a purchase-list page first, then one page per house.
5. **Save day.** It works offline and uploads later. A house can be in only one day.
6. On the Surveys list, **Select** also adds up the wood for any houses you tick.

### Who changed what (managers and admins)
1. Open any survey → last step → **History (who changed what)**.
2. Each change shows **who**, their role, when, from which phone, and a table: **What · Before · After** (for example *Area: Abu Sultan → El-Sheikh Zayed*, *Kitchen: 3.45 × 4 → 3.5 × 4*).
3. **↺ Restore the version from before this change** (tap twice) puts the survey back as it was. The restore is itself a change in the list, so it can be undone too.
4. The **Dashboard** has **Recent changes**: the latest 40 changes to any survey. Tap one to open its history.
5. Researchers and team leaders don't see the history.

## Part 7 – Team leaders: My houses

1. **My houses** lists the houses you were given, grouped by day.
2. **Navigate** opens Google Maps to the house. **Drawing** opens the plan with sizes and beam directions.
3. When a roof is done, tap **Roofed** (it works offline). The app offers to snap a **roof photo** for the dashboard.
4. **PDF of these houses** / **PowerPoint**: the house pages for the day, without the purchase list.
5. **Team picture:** shown next to your team in the rankings.

## Part 8 – Dashboard and photos (everyone)

- **Teams:** houses roofed under each team leader, this month or all time, with medals and "days in a row" streaks.
- **Researchers:** surveys made and reviewed.
- **Stories** (round pictures at the top): anyone can post a photo with a caption and stickers. Stories disappear after **7 days**, at most 5 each.
- **Latest roofs:** the roof photos. Tap one to see it full screen.
- **Storage:** every dashboard photo is shrunk to about 30 KB and kept **inside the sheet**, never in Drive. Old stories are removed from the sheet automatically. 1,000 roof photos are about 30 MB.

## Part 9 – Wood lengths and rounding

**The rule:** beams (عروق) = beam side **+ 30 cm**; planks (ألواح) = plank side **+ 10 cm** for the walls; then rounded **up** to the next length you can buy. Both come in **2.10 m to 6.00 m, every 30 cm**.

| Measured side | Beam (+ 30 cm) | Plank (+ 10 cm) |
|---|---|---|
| 2.00 m | **240 cm** | **210 cm** |
| 2.85 m | **330 cm** | **300 cm** |
| 3.45 m | **390 cm** | **360 cm** |
| 4.00 m | **450 cm** | **420 cm** |
| 4.80 m | **510 cm** | **510 cm** |
| 5.70 m | **600 cm** (the longest) | **600 cm** |

**Beams can't be more than 6 m.** A beam side over **5.70 m** is **invalid**: it must be the plank side. The room shows a red warning with a **Swap beam and plank sides** button, and the survey **can't be submitted or approved** until it's fixed (the sheet checks this too). If both sides are over 5.70 m, split the room.

**Planks over 6 m:** each row uses **2 planks that meet in the middle on one beam**: 7.20 m + 10 cm = 7.30 m → **2 × 390** per row. The middle beam is drawn **bold**. A plank side over 11.90 m shows a red warning: split the room.

How the numbers are worked out:

- **Beam length** = beam side + 30 cm, rounded up. **Number of beams** = plank side ÷ *Beam spacing* (0.60 m), rounded up, + spares.
- **Plank length** = plank side + 10 cm, rounded up. **Number of planks** = beam side ÷ *Plank width* (0.10 m), rounded up, + spares.
- The 30 and 10 are in the **Settings** tab: *Add for beams (cm)* and *Add for walls (cm)*.

**Where to change them:** tab **Wood rules** (one row per length you can buy) and tab **Settings**. Then **Shelter → Recalculate wood for all surveys**.

## Part 10 – Safety of the data

- **Who gets in:** only people with an account. Making one needs the team code; everyone starts as Researcher and only admins raise roles.
- **Passwords:** never stored. The phone stretches the password 600,000 times (PBKDF2-SHA256) before sending it; the sheet keeps only a keyed hash (HMAC-SHA256 with a secret kept in the script, not in the sheet), with a different random salt for each person. A copy of the sheet alone can't be used to test password guesses. Each phone gets its own log-in key, also kept only as a hash.
- **Guessing passwords:** wrong answers are slow, and **5 wrong passwords lock that username for 15 minutes**. Reset codes stop after 5 wrong tries. The app refuses passwords that are too short or too common.
- **No hints for attackers:** "wrong username or password" is the same message either way, and *Forgot password* gives the same answer whether or not the username exists.
- **No injection:** nothing typed becomes a formula in the sheet (a name like `=IMPORTXML(…)` stays plain text). The sheet has no SQL; the app only sends data, never commands, and every rule is checked by the sheet's code, so a changed app can't skip them.
- **Nobody deletes the sheet from the app:** the app has no way to delete a tab or the file, and phones never get access to the sheet itself. Researchers and team leaders delete only **their own** surveys, before approval; managers can delete any. Every deleted survey is copied to the **Deleted** tab first, and its papers stay in Drive's trash for 30 days.
- **Locked tabs:** *History* and *Deleted* can only be edited by the sheet's owner. The other tabs show a warning before anyone edits them by hand.
- **Papers:** only real photos and PDFs are accepted, checked by their content, not their name.
- **History:** every change keeps a full copy before and after, with who, role, phone and app version. Managers see it in the app and can restore.
- **National ID numbers** are never printed on the PDF or PowerPoint.
- **Drafts are private:** only the person who made a survey sees it until it's submitted.
- **The sheet link can't be changed in the app:** it comes from `config.js` on the website only.
- **Keep private:** the sheet, the Drive folder *"Lebaladna Shelter – survey papers"*, the first-time admin codes and the account key. Don't share the sheet with edit rights beyond the admins.

## Part 11 – Updating later

1. **Sheet code first:** in Apps Script, select all, delete, paste the new `Code.gs`, **Save**. Run **`setup`** once (safe to run again; it adds anything new). Then **Deploy → Manage deployments → ✏️ → Version: New version → Deploy**. Don't use *New deployment*, which makes a new link.
2. **Then the app:** upload the new app files to GitHub (all except `config.js`).
3. **Phones update themselves** the next time they open the app with internet. Nobody reinstalls or logs in again. If someone is in the middle of a survey, the update waits until they go back to the list.

Check the version: open the `/exec` link in a browser; Settings in the app shows the app version.

### Start fresh (for example, before the real launch)
In the sheet: **Shelter → Start fresh (delete all data)…** → type `DELETE`. Then choose:
- **No** = keep only the admins (Begad and Hawary); everyone else makes a new account.
- **Yes** = everyone keeps their account.

All surveys, rooms, drawings, papers (to the Drive trash), days, photos, History and Deleted rows go; Settings, Wood rules and Required papers stay. Codes start again at SH-0001. Every phone clears its old data at its next sync, **including anything not uploaded**, so tell testers first. Admins stay logged in.

### Moving to a new sheet later (accounts keep working)
Accounts live in the **Users** tab, and passwords are checked with a secret **account key** kept in the script. To move without anyone making a new account:
1. Old sheet: **Shelter → Show the account key**, copy it.
2. **File → Make a copy** of the whole spreadsheet (the script and the Users tab come with it).
3. In the copy: **Extensions → Apps Script → setup**, then **Shelter → Set the account key** (paste it). If you want it empty: **Shelter → Start fresh**, answer **Yes** to keep everyone's account.
4. **Deploy → New deployment** (Web app, Execute as Me, Anyone) and copy the new `/exec` link.
5. Put the new link in **`config.js`** on GitHub. Every phone switches at its next open, **stays logged in**, and downloads the new sheet's data. Ask everyone to sync before step 5.

## Troubleshooting

| The app says | What to do |
|---|---|
| **That code is not accepted** | Check the team code in the Settings tab. Open the `/exec` link: if it shows an old version, publish a **New version** (Part 11). Check that `config.js` has the same link. |
| **Wrong username or password** | Capitals don't matter in the username, but they do in the password. Or use **Forgot password**. |
| **Too many wrong passwords** | Wait 15 minutes, or use **Forgot password**. |
| **Log in again… Nothing on this phone is lost** | The password was changed or reset on another phone. Log in with the new password; waiting surveys upload after that. |
| **Invalid beam side** | The beam side is over 5.70 m. Tap **Swap beam and plank sides**, or measure again. |
| **Not submitted yet** when leaving | The survey is a draft and only you see it. Tap **Submit for review**, or keep it as a draft. |
| **The team sheet started fresh** | An admin cleared the sheet. This phone removed its old data. |
| No "forgot password" email | Check spam. No email on the account? A manager makes a code (Users → Make a code). Gmail sends at most 100 a day from a normal account. |
| **Almost there** (waiting) | *New people need approval* is **Yes** in Settings. Set it to **No**, or let the person in: app → **Users** → **Let in**. |
| **Save the house location first** | The location is required to submit. Step 1 → **Save house location**, outside near the door. |
| **An admin switched off your access** | Switched off in Users. An admin can switch them on again. |
| **Sync problem: …unexpected (HTTP…)** | The link is not the `/exec` one, or the deployment isn't set to **Anyone**. |
| **Not uploaded** on a survey or photo | It's safe on the phone. Open the app with internet. |
| PowerPoint opens as a zip / in an archive app | Fixed in 1.6. Update the app files (Part 11). |
| **Reset this phone** | Only when the badge says *Saved*. Anything not uploaded is erased. |
| No logos, no *Install app*, or it doesn't open offline | Some files are missing on GitHub. Upload all 16 files again. |
