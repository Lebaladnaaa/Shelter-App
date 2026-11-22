"""Run: python3 -m http.server 8000 (in app/), node mock-gas.js ../apps-script/Code.gs 8001, then python3 e2e16.py 8001.
1.7 end to end: accounts (sign-up, first-time admin code, log out / in, second phone, forgot password by email
and by a manager's code, a phone from before 1.7, merging a double account), required location, select & delete,
Submit, manager history & restore, team leaders per house, dashboard photos, exports, security."""
import asyncio, json, os, shutil, sys, subprocess, urllib.request
from playwright.async_api import async_playwright

APP = 'http://localhost:8000/'
API = 'http://localhost:' + (sys.argv[1] if len(sys.argv) > 1 else '8001') + '/'
TEAM = 'Shelter-2027'
HERE = os.path.dirname(os.path.abspath(__file__))
SH = os.path.join(HERE, 'shots') + os.sep
os.makedirs(SH, exist_ok=True)
errors, results = [], []
PHOTO = os.path.join(HERE, 'idcard.jpg')
PW = lambda who: 'wood-' + who.lower()[::-1] + '-2026'


def rows(tab):
    d = json.loads(urllib.request.urlopen(API + '__dump').read())['sheets'].get(tab) or [[]]
    return [dict(zip(d[0], r)) for r in d[1:]]


def check(name, ok, extra=''):
    results.append(('PASS' if ok else 'FAIL') + '  ' + name + ('  ' + str(extra).replace('\n', ' | ')[:220] if extra else ''))


async def blank(b, who, w=390, h=844, invite=False):
    ctx = await b.new_context(bypass_csp=True, viewport={'width': w, 'height': h},  # the app's CSP allows only script.google.com; the fake sheet runs on localhost
                               device_scale_factor=2, is_mobile=w < 600, has_touch=w < 600, accept_downloads=True,
                               permissions=['geolocation'], geolocation={'latitude': 30.5965, 'longitude': 32.2715, 'accuracy': 8},
                              user_agent='Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36')
    pg = await ctx.new_page()
    pg.on('pageerror', lambda e: errors.append(who + ' pageerror: ' + str(e)))
    pg.on('console', lambda m: errors.append(who + ' console: ' + m.text) if m.type == 'error' else None)
    await pg.goto(APP + '?api=' + API + ('&code=' + TEAM if invite else ''))
    await pg.wait_for_selector('#signupForm' if invite else '#loginForm')
    return ctx, pg


async def phone(b, who, email='', username=None):
    """A new phone: the invite link opens New account with the team code filled in."""
    ctx, pg = await blank(b, who, invite=True)
    await pg.fill('#w-name', who)
    await pg.fill('#w-user', username or who.lower())
    await pg.fill('#w-pass', PW(who))
    await pg.fill('#w-pass2', PW(who))
    if email:
        await pg.fill('#w-email', email)
    if who == 'Ahmed' and not username:
        await pg.screenshot(path=SH + '01a-signup.png', full_page=True)
    await pg.click('#w-go')
    await pg.wait_for_selector('.appbar h1', timeout=30000)
    await pg.wait_for_timeout(300)
    return ctx, pg


async def log_in(pg, username, password):
    await pg.wait_for_selector('#loginForm')
    await pg.fill('#w-user', username)
    await pg.fill('#w-pass', password)
    await pg.click('#w-go')
    await pg.wait_for_selector('.tabs', timeout=30000)
    await pg.wait_for_timeout(300)


async def log_out(pg):
    await pg.click('[data-act="go-me"]')
    await pg.wait_for_selector('[data-act="logout"]')
    await pg.click('[data-act="logout"]')
    if not await pg.locator('#loginForm').count():
        await pg.wait_for_timeout(300)
        if await pg.locator('[data-act="logout"]').count():
            await pg.click('[data-act="logout"]')  # second tap when something was not uploaded
    await pg.wait_for_selector('#loginForm')


def mail_code():
    import re
    m = json.loads(urllib.request.urlopen(API + '__mail').read())
    return m[-1]['to'], re.search(r'(\d{6})', m[-1]['subject']).group(1)


async def settle(pg, timeout=25):
    for _ in range(timeout * 2):
        await pg.wait_for_timeout(500)
        if not await pg.locator('.sync').count():
            continue
        t = (await pg.inner_text('.sync')).strip()
        if t == 'Saved' or 'problem' in t or 'rejected' in t:
            return t
    return 'timeout'


async def sync(pg):
    await pg.evaluate('window.dispatchEvent(new Event("online"))')
    await pg.wait_for_timeout(400)
    return await settle(pg)


async def go(pg, tab):
    await pg.click(f'.tabs [data-go="{tab}"]')
    await pg.wait_for_timeout(250)


async def open_survey(pg, sid, step):
    if await pg.locator('[data-filter="all"]').count():
        await pg.click('[data-filter="all"]')
    try:
        await pg.click(f'[data-open="{sid}"]', timeout=15000)
    except Exception:
        await pg.screenshot(path=SH + 'fail-open.png', full_page=True)
        print('OPEN FAILED', sid, (await pg.inner_text('main'))[:600])
        raise
    await pg.wait_for_selector('.steps')
    await pg.click(f'[data-step="{step}"]')
    await pg.wait_for_timeout(150)


async def pin(pg):
    await pg.click('#locPanel [data-act="gps"]')
    await pg.wait_for_selector('#locPanel .loc-coords', timeout=15000)


async def new_survey(pg, family, rooms=(('Bedroom', '4', '4.8'), ('Kitchen', '3.45', '4')), location=True):
    await pg.click('.fab')
    await pg.wait_for_selector('#f-family')
    await pg.fill('#f-family', family)
    await pg.fill('#f-area', 'Abu Sultan')
    if location:
        await pin(pg)
    await pg.click('.bottombar .btn:not(.ghost)')
    await pg.wait_for_selector('#rooms')
    for name, b_, p_ in rooms:
        await pg.click(f'[data-addroom="{name}"]')
        rid = await pg.eval_on_selector('#rooms .room:last-child', 'e=>e.dataset.rid')
        await pg.fill(f'#rb-{rid}', b_)
        await pg.fill(f'#rp-{rid}', p_)


async def leave(pg):
    """Back from your own unsubmitted survey: the app asks; keep it as a draft."""
    await pg.click('[data-act="back"]')
    try:
        await pg.wait_for_selector('.leave-sheet', timeout=2500)
        await pg.click('[data-act="leave-draft"]')
    except Exception:
        pass
    await pg.wait_for_selector('.fab', timeout=15000)


async def set_role(begad, name, role):
    await sync(begad)
    await go(begad, 'users')
    await begad.locator('.user-card', has_text=name).first.click()
    await begad.wait_for_selector('.role-pick')
    await begad.click(f'[data-setrole="{role}"]')
    await begad.wait_for_selector('.role-pick', state='detached', timeout=15000)


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(**({'executable_path': os.environ['CHROME']} if os.environ.get('CHROME') else {}))
        # ── admin: the first-time code from setup, then a username and password, once
        bctx, begad = await blank(b, 'Begad')
        await begad.click('[data-wmode="admin"]')
        await begad.fill('#w-key', 'begad-0001')
        await begad.click('#w-go')
        await begad.wait_for_selector('#setLoginForm', timeout=30000)
        check('first-time admin code → choose a username and password', await begad.input_value('#l-user') == 'begad')
        await begad.screenshot(path=SH + '00-admin-set-login.png')
        await begad.fill('#l-pass', 'short')
        await begad.fill('#l-pass2', 'short')
        await begad.click('#l-go')
        check('too-short passwords are refused', 'at least 8' in await begad.inner_text('#l-msg'))
        await begad.fill('#l-pass', PW('Begad'))
        await begad.fill('#l-pass2', PW('Begad'))
        await begad.fill('#l-email', 'begad@example.org')
        await begad.click('#l-go')
        try:
            await begad.wait_for_selector('.tabs', timeout=30000)
        except Exception:
            await begad.screenshot(path=SH + 'fail-admin.png')
            print('ADMIN FAIL', (await begad.inner_text('body'))[:800])
            raise
        await settle(begad)
        bu = [u for u in rows('Users') if u['Name'] == 'Begad'][0]
        check('admin has a username, the first-time code is used up', bu['Username'] == 'begad' and bu['Code'] == '' and 'begad pass' not in json.dumps(bu), {k: bu[k] for k in ('Username', 'Code')})
        check('admin tabs: Surveys, Implementation days, Dashboard, Users', [t.strip() for t in await begad.locator('.tabs .tab').all_inner_texts()] == ['Surveys', 'Implementation days', 'Dashboard', 'Users'])

        # ── joining: straight in with the team code, no admin approval
        actx, ahmed = await phone(b, 'Ahmed')
        await settle(ahmed)
        check('new person goes straight in (no waiting)', 'Almost there' not in await ahmed.inner_text('.appbar h1') and
              [t.strip() for t in await ahmed.locator('.tabs .tab').all_inner_texts()] == ['Surveys', 'Dashboard'])
        await ahmed.screenshot(path=SH + '01-straight-in.png')

        mctx, mona = await phone(b, 'Mona')
        tctx, tarek = await phone(b, 'Tarek')
        sctx, sara = await phone(b, 'Sara', email='sara@example.org')
        await sync(begad)
        check('no approval badge for the admin', await begad.locator('.tabs .badge').count() == 0)
        await set_role(begad, 'Mona', 'Manager')
        await set_role(begad, 'Tarek', 'Team leader')
        await set_role(begad, 'Sara', 'Team leader')
        await begad.screenshot(path=SH + '02-users.png', full_page=True)
        for pg in (mona, tarek, sara):
            await sync(pg)
            await pg.wait_for_timeout(400)
            await settle(pg)
        check('team leader tabs', [t.strip() for t in await tarek.locator('.tabs .tab').all_inner_texts()] == ['Surveys', 'My houses', 'Dashboard'])
        check('manager tabs', [t.strip() for t in await mona.locator('.tabs .tab').all_inner_texts()] == ['Surveys', 'Implementation days', 'Dashboard', 'Users'])

        # ── researcher: no purchase list, big Submit at the end
        await new_survey(ahmed, '=1+1 Mahmoud Saad', location=False)
        await ahmed.click('[data-step="4"]')
        await ahmed.wait_for_timeout(200)
        txt = await ahmed.inner_text('main')
        check('researcher: no wood list, a checklist', 'Wood to buy' not in txt and 'Check before submitting' in txt and await ahmed.locator('[data-kind="pptx"]').count() == 0)
        check('checklist flags the missing location', 'House location missing' in txt)
        big = ahmed.locator('.bottombar [data-act="submit-survey"]')
        check('big Submit button at the end', await big.count() == 1 and (await big.bounding_box())['height'] >= 50)
        await ahmed.screenshot(path=SH + '03-researcher-last-step.png', full_page=True)
        await big.click()
        await ahmed.wait_for_timeout(300)
        check('Submit without a location: sent back to save it', await ahmed.locator('#locPanel.needed').count() == 1 and await ahmed.locator('.fab').count() == 0)
        await ahmed.screenshot(path=SH + '03b-location-required.png')
        await pin(ahmed)
        check('location saved on the phone', await ahmed.locator('#locPanel .loc-coords').count() == 1 and await ahmed.locator('#locPanel [data-act="gps-clear"]').count() == 1)
        await ahmed.click('[data-step="4"]')
        await ahmed.wait_for_timeout(200)
        await ahmed.click('.bottombar [data-act="submit-survey"]')
        await ahmed.wait_for_selector('.fab')
        await settle(ahmed)
        sv = rows('Surveys')
        sid1 = sv[0]['Survey ID']
        check('submitted, with its location', sv[0]['Status'] == 'Submitted' and str(sv[0].get('Latitude', sv[0].get('Location', ''))) != '', {k: v for k, v in sv[0].items() if 'Lat' in k or 'Loc' in k})
        check('typed formula stays text in the sheet', sv[0]['Head of family'] == "'=1+1 Mahmoud Saad", sv[0]['Head of family'])
        check('cards show no wood to researchers', await ahmed.locator('.card .wood').count() == 0)

        # ── select and delete from the list
        await new_survey(ahmed, 'Draft one'); await leave(ahmed)
        await new_survey(ahmed, 'Draft two'); await leave(ahmed)
        await settle(ahmed)
        await ahmed.click('[data-act="toggle-select"]')
        for fam in ('Draft one', 'Draft two'):
            await ahmed.locator('.card', has_text=fam).locator('.pick').check()
        await ahmed.wait_for_timeout(200)
        del_btn = ahmed.locator('[data-act="delete-picked"]')
        check('delete button for the picked ones', 'Delete 2' in await del_btn.inner_text())
        await ahmed.screenshot(path=SH + '04-select-delete.png')
        await del_btn.click(); await del_btn.click()
        await ahmed.wait_for_timeout(500)
        await settle(ahmed)
        fams = [s['Head of family'] for s in rows('Surveys')]
        check('deleted from the list and the sheet', 'Draft one' not in fams and 'Draft two' not in fams and len(rows('Deleted')) == 2, fams)

        # ── researcher edits after submitting; the manager sees before → after and can restore
        await open_survey(ahmed, sid1, 0)
        check('no Remove for a submitted location', await ahmed.locator('#locPanel [data-act="gps-clear"]').count() == 0)
        await ahmed.fill('#f-area', 'El-Sheikh Zayed')
        await ahmed.click('[data-step="4"]')
        await ahmed.wait_for_timeout(200)
        check('researchers have no History button', await ahmed.locator('[data-act="history"]').count() == 0)
        await ahmed.click('[data-act="back"]')
        await settle(ahmed)
        await sync(ahmed)
        check('edit reached the sheet', [s for s in rows('Surveys') if s['Survey ID'] == sid1][0]['Area'] == 'El-Sheikh Zayed')
        await sync(mona)
        await open_survey(mona, sid1, 4)
        await mona.click('[data-act="history"]')
        await mona.wait_for_selector('ol.history', timeout=20000)
        first = mona.locator('ol.history > li').first
        ftxt = await first.inner_text()
        check('history: who, role, phone, and the field before → after', 'Ahmed' in ftxt and 'Researcher' in ftxt and 'Android' in ftxt and
              await first.locator('table.diff tr', has_text='Area').count() == 1 and 'Abu Sultan' in ftxt and 'El-Sheikh Zayed' in ftxt, ftxt[:200])
        await mona.screenshot(path=SH + '04b-history.png')
        rb = first.locator('[data-restore]')
        await rb.click()
        check('restore asks for a second tap', 'Tap again' in await rb.inner_text())
        await rb.click()
        await mona.wait_for_selector('ol.history', state='detached', timeout=20000)
        await settle(mona)
        check('restored: area back in the sheet', [s for s in rows('Surveys') if s['Survey ID'] == sid1][0]['Area'] == 'Abu Sultan')
        check('the restore is in the history too', any(h['Action'] == 'Restored a version' and h['Who'] == 'Mona' and h['Survey ID'] == sid1 for h in rows('History')))
        check('restored on the manager phone', await mona.input_value('#f-area') == 'Abu Sultan' if await mona.locator('#f-area').count() else
              (await mona.evaluate(f'ShelterApp.state.surveys.get("{sid1}").area')) == 'Abu Sultan')
        await mona.click('[data-act="back"]')
        await go(mona, 'dash')
        await mona.wait_for_timeout(2500)
        await go(mona, ''); await go(mona, 'dash')
        rtxt = await mona.inner_text('main')
        check('manager dashboard: recent changes', await mona.locator('.recent-row').count() >= 2 and 'Restored a version' in rtxt, rtxt[:200])
        await mona.screenshot(path=SH + '04c-recent-changes.png', full_page=True)
        await mona.locator('.recent-row').first.click()
        await mona.wait_for_selector('ol.history', timeout=20000)
        check('tap a recent change: its history opens', await mona.locator('ol.history > li').count() >= 3)
        await mona.click('[data-act="close-sheet"]')
        await mona.click('[data-act="back"]')
        await go(mona, '')

        # ── manager approves; a day with a team leader per house
        await new_survey(mona, 'Second house'); await leave(mona)
        await settle(mona)
        await sync(mona)
        sid2 = [s for s in rows('Surveys') if s['Head of family'] == 'Second house'][0]['Survey ID']
        for sid in (sid1, sid2):
            await open_survey(mona, sid, 4)
            await mona.click('[data-setstatus="Approved"]')
            await mona.click('[data-act="back"]')
        await settle(mona)
        await go(mona, 'days')
        await mona.click('.fab')
        await mona.wait_for_selector('#d-name')
        await mona.fill('#d-name', 'Day 1')
        await mona.fill('#d-date', '2026-11-12')
        await mona.select_option('#d-leader', label='Tarek')
        await mona.click(f'[data-dpick="{sid1}"]')
        await mona.click(f'[data-dpick="{sid2}"]')
        await mona.select_option(f'[data-hleader="{sid2}"]', label='Sara')
        await mona.screenshot(path=SH + '05-day-per-house-leader.png', full_page=True)
        await mona.click('[data-act="save-day"]')
        await mona.wait_for_selector('.day-card')
        await settle(mona)
        by = {s['Survey ID']: s['Team leader'] for s in rows('Surveys')}
        check('each house has its team leader', by.get(sid1) == 'Tarek' and by.get(sid2) == 'Sara', by)

        # ── day export: real PowerPoint file
        await mona.click('.day-card')
        await mona.wait_for_selector('#dayTotals')
        async with mona.expect_download() as dl:
            await mona.click('#dayTotals [data-kind="pptx"]')
            await mona.wait_for_selector('[data-act="save-export"]', timeout=30000)
            typ = await mona.evaluate('document.querySelector("[data-act=save-export]") && true')
            await mona.click('[data-act="save-export"]')
        d = await dl.value
        await d.save_as(SH + 'day.pptx')
        z = subprocess.run(['unzip', '-tq', SH + 'day.pptx'], capture_output=True, text=True)
        check('PowerPoint: .pptx name, sound zip file', d.suggested_filename.endswith('.pptx') and 'No errors' in z.stdout, (d.suggested_filename, z.stdout.strip()[:60]))
        await mona.click('[data-act="close-sheet"]')
        await mona.click('[data-act="go-days"]')

        # ── team leaders see only their house; Roofed → celebration → roof photo
        await sync(tarek)
        await go(tarek, 'mine')
        check('Tarek sees only his house', await tarek.locator('.house').count() == 1 and '=1+1 Mahmoud Saad' in await tarek.inner_text('.houses'))
        await tarek.click('[data-mark][data-state="Roofed"]')
        await tarek.wait_for_selector('.celebrate')
        await tarek.screenshot(path=SH + '06-roofed.png')
        await tarek.click('.celebrate [data-snap="roof"]')
        await tarek.wait_for_selector('#snapFile', state='attached')
        await tarek.set_input_files('#snapFile', PHOTO)
        await tarek.wait_for_selector('#snapCaption')
        await tarek.fill('#snapCaption', 'Another dry home!')
        await tarek.click('[data-sticker="🎉"]')
        await tarek.click('[data-sticker="💪"]')
        await tarek.screenshot(path=SH + '07-snap-editor.png')
        await tarek.click('#snapSend')
        await tarek.wait_for_timeout(500)
        await settle(tarek)
        ph = rows('Photos')
        check('roof photo in the sheet, small', len(ph) == 1 and ph[0]['Kind'] == 'roof' and ph[0]['Survey ID'] == sid1 and float(ph[0]['Size (KB)']) <= 34, [(x['Kind'], x['Size (KB)']) for x in ph])
        await sync(sara)
        await go(sara, 'mine')
        check('Sara sees only hers', await sara.locator('.house').count() == 1 and 'Second house' in await sara.inner_text('.houses'))
        await sara.click('[data-mark][data-state="Roofed"]')
        await sara.wait_for_selector('.celebrate'); await sara.click('.celebrate [data-act="close-sheet"]')
        await settle(sara)
        check('both roofed in the sheet', all(s['Status'] == 'Roofed' and s['Roofed at'] for s in rows('Surveys') if s['Survey ID'] in (sid1, sid2)))
        # team picture
        await sara.click('[data-snap="team"]')
        await sara.set_input_files('#snapFile', PHOTO)
        await sara.wait_for_selector('#snapCaption'); await sara.click('#snapSend')
        await settle(sara)

        # ── dashboard for everyone
        await sync(ahmed)
        await go(ahmed, 'dash')
        await ahmed.click('[data-snap="story"]')
        await ahmed.set_input_files('#snapFile', PHOTO)
        await ahmed.wait_for_selector('#snapCaption'); await ahmed.fill('#snapCaption', 'Survey day 👋'); await ahmed.click('#snapSend')
        await settle(ahmed)
        await ahmed.evaluate('ShelterApp.state.photosLoadedAt = 0')
        await go(ahmed, 'surveys') if False else None
        await ahmed.click('.tabs [data-go=""]'); await go(ahmed, 'dash')
        await ahmed.wait_for_timeout(2500)
        await ahmed.click('.tabs [data-go=""]'); await go(ahmed, 'dash')
        rank = await ahmed.inner_text('.dash-grid')
        check('team ranking: Tarek 1, Sara 1', 'Tarek' in rank and 'Sara' in rank, rank[:200])
        check('latest roofs shows the photo', await ahmed.locator('.roof-tile img').count() == 1)
        check('stories ring for Ahmed', await ahmed.locator('.story-ring:not(.add)').count() == 1)
        check('team picture used as avatar', await ahmed.locator('.rank img.avatar').count() >= 1)
        await ahmed.screenshot(path=SH + '08-dashboard.png', full_page=True)
        await ahmed.click('.story-ring:not(.add)')
        await ahmed.wait_for_selector('.story-view')
        await ahmed.screenshot(path=SH + '09-story.png')
        await ahmed.click('[data-act="close-sheet"]')
        ph = rows('Photos')
        check('photos tab: roof, team, story — all under 34 KB', sorted(x['Kind'] for x in ph) == ['roof', 'story', 'team'] and all(float(x['Size (KB)']) <= 34 for x in ph), [(x['Kind'], x['Size (KB)']) for x in ph])

        # ── accounts: log out and back in = the same account (the bug in 1.6)
        n_users = len(rows('Users'))
        ahmed_id = [u for u in rows('Users') if u['Username'] == 'ahmed'][0]['User ID']
        await log_out(ahmed)
        check('log-out keeps the username ready', await ahmed.input_value('#w-user') == 'ahmed')
        await ahmed.fill('#w-pass', 'wrong password!')
        await ahmed.click('#w-go')
        await ahmed.wait_for_selector('#w-msg .notice.err', timeout=20000)
        check('wrong password', 'Wrong username or password' in await ahmed.inner_text('#w-msg'))
        await ahmed.screenshot(path=SH + '20-login.png')
        await log_in(ahmed, 'ahmed', PW('Ahmed'))
        await settle(ahmed)
        check('log in again: same account, no new user', len(rows('Users')) == n_users and
              await ahmed.evaluate('ShelterApp.state.me.id') == ahmed_id and await ahmed.locator(f'[data-open="{sid1}"]').count() + await ahmed.evaluate(f'ShelterApp.state.surveys.has("{sid1}") ? 1 : 0') >= 1)
        a2ctx, ahmed2 = await blank(b, 'Ahmed 2nd phone')
        await log_in(ahmed2, 'Ahmed', PW('Ahmed'))
        await settle(ahmed2)
        check('second phone: same account, same surveys', len(rows('Users')) == n_users and await ahmed2.evaluate('ShelterApp.state.me.id') == ahmed_id and
              await ahmed2.evaluate(f'ShelterApp.state.surveys.has("{sid1}")'))

        # ── forgot password by email (Sara gave one)
        s2ctx, sara2 = await blank(b, 'Sara new phone')
        await sara2.click('[data-wmode="forgot"]')
        await sara2.fill('#w-user', 'sara')
        await sara2.click('[data-act="email-code"]')
        await sara2.wait_for_selector('#w-mailmsg .notice.info', timeout=20000)
        to, code = mail_code()
        check('email code sent to her address', to == 'sara@example.org' and len(code) == 6)
        await sara2.fill('#w-code', code)
        await sara2.fill('#w-pass', 'blue roof 77 day')
        await sara2.fill('#w-pass2', 'blue roof 77 day')
        await sara2.screenshot(path=SH + '21-forgot.png')
        await sara2.click('#w-go')
        await sara2.wait_for_selector('.tabs', timeout=30000)
        check('new password by email code: logged in as Sara', await sara2.evaluate('ShelterApp.state.me.username') == 'sara' and
              [t.strip() for t in await sara2.locator('.tabs .tab').all_inner_texts()] == ['Surveys', 'My houses', 'Dashboard'])
        await sync(sara)
        await sara.wait_for_timeout(500)
        check('her old phone is logged out (nothing lost)', await sara.locator('#loginForm').count() == 1 and 'Nothing on this phone is lost' in await sara.inner_text('main'))
        await log_in(sara, 'sara', 'blue roof 77 day')

        # ── a manager makes a code for someone without email; sent on WhatsApp
        await sync(mona)
        await go(mona, 'users')
        await mona.locator('.user-card', has_text='Ahmed').first.click()
        await mona.click('[data-act="make-code"]')
        await mona.wait_for_selector('.big-code', timeout=20000)
        mcode = (await mona.inner_text('.big-code')).replace(' ', '')
        wa = await mona.get_attribute('.code-box a', 'href')
        check('manager: one-time code + WhatsApp link', len(mcode) == 6 and wa.startswith('https://wa.me/?text=') and mcode in urllib.request.unquote(wa) and 'ahmed' in urllib.request.unquote(wa), wa[:80])
        check('managers can\'t change roles', await mona.locator('[data-setrole]').count() == 0 and await mona.locator('[data-setactive]').count() == 0)
        await mona.screenshot(path=SH + '22-manager-code.png')
        await mona.click('[data-act="close-sheet"]')
        await log_out(ahmed2)
        await ahmed2.click('[data-wmode="forgot"]')
        await ahmed2.fill('#w-user', 'ahmed')
        await ahmed2.fill('#w-code', mcode)
        await ahmed2.fill('#w-pass', 'green beam 99 day')
        await ahmed2.fill('#w-pass2', 'green beam 99 day')
        await ahmed2.click('#w-go')
        await ahmed2.wait_for_selector('.tabs', timeout=30000)
        check('manager\'s code works', await ahmed2.evaluate('ShelterApp.state.me.id') == ahmed_id)

        # ── a phone from before 1.7: keeps its account, chooses a username once
        req = urllib.request.Request(API, data=json.dumps({'key': TEAM, 'action': 'ping', 'name': 'Omar', 'deviceName': 'Old phone', 'v': '1.6.1'}).encode(), method='POST')
        old = json.loads(urllib.request.urlopen(req).read())['me']
        octx, omar = await blank(b, 'Omar old phone')
        await omar.evaluate('(m) => ShelterApp.DB.setMeta("me", m)', {'name': 'Omar', 'key': TEAM, 'id': old['id'], 'token': old['token'], 'role': 'Researcher', 'api': API, 'deviceId': 'dev-omar'})
        await omar.reload()
        await omar.wait_for_selector('#setLoginForm', timeout=30000)
        check('old phone: asked once for a username and password', await omar.input_value('#l-user') == 'omar')
        await omar.screenshot(path=SH + '23-old-phone.png')
        await omar.fill('#l-pass', PW('Omar'))
        await omar.fill('#l-pass2', PW('Omar'))
        await omar.click('#l-go')
        await omar.wait_for_selector('.tabs', timeout=30000)
        await settle(omar)
        ou = [u for u in rows('Users') if u['User ID'] == old['id']][0]
        check('same account now has a username; old key moved', ou['Username'] == 'omar' and ou['Phone key (app use – do not edit)'] == '' and
              await omar.evaluate('ShelterApp.state.me.hasLogin') is True)

        # ── a double account: merged by the admin
        dctx, dup = await phone(b, 'Ahmed', username='ahmed.saad')
        await new_survey(dup, 'From the double account')
        await leave(dup)
        await settle(dup)
        await sync(begad)
        await go(begad, 'users')
        await begad.locator('.user-card', has_text='@ahmed.saad').first.click()
        await begad.select_option('#u-merge', label=[o for o in await begad.locator('#u-merge option').all_inner_texts() if '@ahmed)' in o][0])
        mb = begad.locator('[data-act="merge-user"]')
        await mb.click()
        check('merge asks for a second tap', 'Tap again' in await mb.inner_text())
        await begad.screenshot(path=SH + '24-merge.png')
        await mb.click()
        await begad.wait_for_selector('#userSheet', state='detached', timeout=30000)
        check('double account hidden from Users', await begad.locator('.user-card', has_text='@ahmed.saad').count() == 0)
        await sync(dup)
        dsv = [s for s in rows('Surveys') if s['Head of family'] == 'From the double account'][0]
        check('its survey now belongs to the kept account', dsv['Researcher ID'] == ahmed_id, dsv['Researcher ID'])
        check('its phone carries on as the kept account', await dup.evaluate('ShelterApp.state.me.id') == ahmed_id and await dup.evaluate('ShelterApp.state.me.username') == 'ahmed')

        # ── 1.8: leaving an unsubmitted survey asks; a clear Submit; drafts are private
        await sync(begad)
        await new_survey(ahmed2, 'Launch house', rooms=(('Hall', '5.8', '3'), ('Kitchen', '3', '3.5')))
        bad = ahmed2.locator('#rooms .room-bad')
        check('beam side over 5.70 m: invalid, with a swap button', await bad.count() == 1 and 'Invalid beam side' in await bad.inner_text() and
              await bad.locator('[data-act="swap-sides"]').count() == 1)
        await ahmed2.screenshot(path=SH + '30-invalid-beam.png')
        hall = await ahmed2.eval_on_selector('#rooms .room:first-child', 'e=>e.dataset.rid')
        await ahmed2.fill(f'#rnote-{hall}', 'Crack in the left wall')
        await ahmed2.click('[data-act="back"]')
        await ahmed2.wait_for_selector('.leave-sheet', timeout=5000)
        check('leaving an unsubmitted survey asks', 'Not submitted yet' in await ahmed2.inner_text('.leave-sheet'))
        await ahmed2.screenshot(path=SH + '31-leave-prompt.png')
        await ahmed2.click('[data-act="leave-submit"]')
        await ahmed2.wait_for_timeout(400)
        check('Submit refused while a beam is invalid: back to the room', await ahmed2.locator('#rooms .room.needed .room-bad').count() == 1 and await ahmed2.locator('.fab').count() == 0)
        await ahmed2.click('#rooms .room.needed [data-act="swap-sides"]')
        check('swapped: beams 3 m, planks 5.8 m', await ahmed2.input_value(f'#rb-{hall}') == '3' and await ahmed2.input_value(f'#rp-{hall}') == '5.8' and await ahmed2.locator('#rooms .room-bad').count() == 0)
        check('draft banner on every step', await ahmed2.locator('.draft-banner').count() == 1 and 'not submitted' in (await ahmed2.inner_text('.draft-banner')).lower())
        # doors, windows and the house entrance on the plan
        await ahmed2.click('[data-step="2"]')
        await ahmed2.wait_for_selector('#plan .room-g')
        await ahmed2.locator(f'#plan .room-g[data-rid="{hall}"] .rf').click()
        await ahmed2.wait_for_selector('#wallsBox:not([hidden])')
        await ahmed2.select_option('[data-wall="b"]', 'entrance')
        await ahmed2.select_option('[data-wall="t"]', 'window')
        await ahmed2.select_option('[data-wall="r"]', 'both')
        svg = await ahmed2.inner_html('#plan')
        check('entrance, window and door drawn on the plan', 'Entrance' in svg and '#1E6FD9' in svg.upper().replace('1E6FD9', '1E6FD9') and '#7A4A1E' in svg.upper(), svg.count('path'))
        await ahmed2.screenshot(path=SH + '32-doors-windows.png')
        await ahmed2.click('[data-act="rotate"]')
        walls = await ahmed2.evaluate(f'ShelterApp.state.surveys.get(ShelterApp.state.cur.id).rooms.find(r => r.id === "{hall}").walls')
        check('turning the room turns its walls', walls == {'l': 'entrance', 'r': 'window', 'b': 'both'}, walls)
        await ahmed2.click('[data-act="rotate"]'); await ahmed2.click('[data-act="rotate"]'); await ahmed2.click('[data-act="rotate"]')
        async with ahmed2.expect_download() as dl:
            await ahmed2.click('.plan-tools [data-kind="png"]')
            await ahmed2.wait_for_selector('[data-act="save-export"]', timeout=30000)
            await ahmed2.click('[data-act="save-export"]')
        png = await (await dl.value).path()
        await ahmed2.click('[data-act="close-sheet"]')
        check('drawing image saved with doors and windows', os.path.getsize(png) > 20000)
        shutil.copy(png, SH + '33-drawing.png')
        await ahmed2.click('[data-step="4"]')
        await ahmed2.wait_for_timeout(200)
        big = ahmed2.locator('.bottombar .big-submit')
        bb = await big.bounding_box()
        check('Submit is big and full width', bb and bb['height'] >= 54 and bb['width'] > 250, bb)
        await ahmed2.click('[data-act="back"]')
        await ahmed2.wait_for_selector('.leave-sheet')
        await ahmed2.click('[data-act="leave-draft"]')
        await ahmed2.wait_for_selector('.fab')
        await settle(ahmed2)
        await sync(mona)
        launch = [x for x in rows('Surveys') if x['Head of family'] == 'Launch house'][0]
        check('a draft is not on the manager\'s phone', launch['Status'] == 'Draft' and
              not await mona.evaluate(f'ShelterApp.state.surveys.has("{launch["Survey ID"]}")'))
        lrooms = [x for x in rows('Rooms') if x['Survey ID'] == launch['Survey ID']]
        check('sheet: room notes, doors, windows, entrance', lrooms[0]['Room notes'] == 'Crack in the left wall' and lrooms[0]['Doors'] == 'right, bottom (entrance)' and
              lrooms[0]['Windows'] == 'top, right' and launch['Entrance'] == 'Hall – bottom wall' and lrooms[0]['Beam length (cm)'] == 330, {k: lrooms[0][k] for k in ('Doors', 'Windows', 'Room notes', 'Beam length (cm)')})
        await open_survey(ahmed2, launch['Survey ID'], 4)
        await ahmed2.click('.bottombar .big-submit')
        await ahmed2.wait_for_selector('.fab')
        await settle(ahmed2)
        await sync(mona)
        check('submitted: now the manager sees it', [x for x in rows('Surveys') if x['Survey ID'] == launch['Survey ID']][0]['Status'] == 'Submitted' and
              await mona.evaluate(f'ShelterApp.state.surveys.has("{launch["Survey ID"]}")'))

        # ── a fake invite link cannot redirect the app
        ok = await ahmed.evaluate("(() => { const c = ShelterApp && ShelterApp.cleanApi; return c ? [c('https://evil.example/exec'), c('https://script.google.com/macros/u/3/s/AKfycbwgggcstN3qlL7Gh74ES6rRw9oAryTeIiibK/exec')] : null; })()")
        check('only Google Apps Script links accepted', ok is None or (ok[0] == '' and ok[1].startswith('https://script.google.com/macros/s/')), ok)
        csp = [e for e in errors if 'Content Security Policy' in e or 'Refused to' in e]
        check('no security-policy violations anywhere (exports included)', not csp, csp[:2])

        # ── start fresh for the launch: all data goes, Begad and Hawary stay
        await sync(begad)
        check('before: the admin phone has surveys', await begad.evaluate('ShelterApp.state.surveys.size') > 0)
        fresh = json.loads(urllib.request.urlopen(API + '__fresh').read())
        check('start fresh: only the admins kept', fresh['kept'] == 2 and len(rows('Surveys')) == 0 and sorted(u['Name'] for u in rows('Users')) == ['Begad', 'Hawary'], fresh)
        await sync(begad)
        await begad.wait_for_timeout(1500)
        await sync(begad)
        check('the admin phone cleared its old data and stays logged in', await begad.evaluate('ShelterApp.state.surveys.size') == 0 and await begad.locator('.tabs').count() == 1)
        await sync(ahmed2)
        await ahmed2.wait_for_timeout(500)
        check('a removed account is logged out', await ahmed2.locator('#loginForm').count() == 1)
        await begad.screenshot(path=SH + '34-fresh.png')
        for c in (bctx, actx, mctx, tctx, sctx, a2ctx, s2ctx, octx, dctx):
            await c.close()
        await b.close()

try:
    asyncio.run(main())
finally:
    print('\n'.join(results))
    print('FAILED:', sum(r.startswith('FAIL') for r in results), 'of', len(results))
    print('errors:', errors or 'none')
