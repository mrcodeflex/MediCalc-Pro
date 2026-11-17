// End-to-end test in an emulated Pixel 7 (touch, 412x915). Optional; the calculation tests need no packages.
//   npm i -D playwright && npx playwright install chromium
//   node tests/ui.test.js            (screenshots are written to tests/shots/)
'use strict';
const { chromium, devices } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'www');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
    '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff': 'font/woff' };
const server = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p.endsWith('/')) p += 'index.html';
    const file = path.join(ROOT, p);
    if (!file.startsWith(ROOT) || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
});
const PORT = 8765;
const BASE = `http://localhost:${PORT}/index.html`;
const SHOTS = path.join(__dirname, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });

let pass = 0, fail = 0;
const check = (name, cond, extra = '') => { if (cond) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + ' ' + extra); } };
const pixel = devices['Pixel 7'];

server.listen(PORT, async () => {
  const browser = await chromium.launch();
  const mk = async (opts = {}) => {
    const ctx = await browser.newContext({ ...pixel, permissions: ['clipboard-read', 'clipboard-write'], ...opts });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
    page.on('requestfailed', (r) => errors.push('requestfailed: ' + r.url()));
    return { ctx, page, errors };
  };

  // ---------- main session ----------
  const { ctx, page, errors } = await mk();
  await page.clock.install({ time: new Date('2026-11-16T10:00:00') });
  await page.goto(BASE);
  await page.waitForSelector('.row');

  const hash = () => page.evaluate(() => location.hash);
  const vis = (s) => page.isVisible(s);
  const txt = (s) => page.textContent(s);
  const fid = (calc, f) => `#page-${calc}-${f}`;
  const openCalc = async (id) => { await page.click(`#view-home [data-open="${id}"], #view-favorites [data-open="${id}"]`); await page.waitForSelector(`#page-${id}.open`); };
  const back = async () => { await page.click('.page.open [data-back]'); await page.waitForFunction(() => !document.querySelector('.page.open')); };
  const fill = async (calc, m) => { for (const [f, v] of Object.entries(m)) await page.fill(fid(calc, f), String(v)); };
  const seg = async (calc, label, option) => { await page.locator(`${'#page-' + calc} .field`).filter({ hasText: label }).locator('button[role=radio]', { hasText: option }).first().click(); };
  const calcBtn = () => page.click('.page.open .btn.primary');
  const sheet = async () => { await page.waitForSelector('.sheet.show'); return page.textContent('.sheet'); };
  const closeSheet = async () => { await page.click('.sheet .icon-btn'); await page.waitForFunction(() => !document.querySelector('.sheet.show')); };
  const primary = () => page.textContent('.sheet .num-xl');

  console.log('Load + layout');
  check('17 calculators listed', (await page.locator('#view-home .row').count()) === 17);
  check('4 category sections', (await page.locator('#view-home .sec-title').count()) === 4);
  check('bundled font loaded', await page.evaluate(() => document.fonts.check('600 16px "MC Sans"')));
  check('no horizontal overflow on home', await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));
  check('bottom nav shows 3 tabs', (await page.locator('.tab').count()) === 3 && (await vis('.tabbar')));
  await page.screenshot({ path: SHOTS + '/01-home.png' });

  console.log('Search + filter');
  await page.fill('#search', 'kidney');
  check('search "kidney" finds eGFR', (await page.locator('#view-home .row-title').allTextContents()).includes('eGFR'));
  await page.fill('#search', 'zzzz');
  check('no match shows empty state', await vis('#view-home .empty'));
  await page.fill('#search', 'bun');
  check('keyword search ("bun" -> serum osmolality)', (await page.locator('#view-home .row').count()) === 1);
  await page.click('#search-clear');
  check('clear restores full list', (await page.locator('#view-home .row').count()) === 17);
  await page.click('.chip[data-cat="chem"]');
  check('Chemistry chip -> 3 rows', (await page.locator('#view-home .row').count()) === 3);
  await page.click('.chip[data-cat="all"]');

  console.log('eGFR flow');
  await openCalc('egfr');
  check('route is #/c/egfr', (await hash()) === '#/c/egfr');
  check('race switch hidden for 2021', !(await vis(fid('egfr', 'race'))));
  await fill('egfr', { creatinine: '1.1', age: '50' });
  await page.waitForTimeout(450);
  await page.screenshot({ path: SHOTS + '/02-form.png' });
  await calcBtn();
  let s = await sheet();
  check('eGFR 81.8 + stage chip G2', (await primary()) === '81.8' && /G2 · Mildly decreased/.test(s), s);
  check('scale marks G2', (await page.locator('.scale-item.on .scale-code').textContent()) === 'G2');
  check('route is #/c/egfr/result', (await hash()) === '#/c/egfr/result');
  await page.waitForTimeout(450);
  await page.screenshot({ path: SHOTS + '/03-result-egfr.png' });
  await page.goBack();
  await page.waitForFunction(() => !document.querySelector('.sheet.show'));
  check('Back closes the sheet but stays on the calculator', (await hash()) === '#/c/egfr' && (await vis('#page-egfr.open')));
  check('entered values are kept', (await page.inputValue(fid('egfr', 'creatinine'))) === '1.1');

  await seg('egfr', 'Serum creatinine', 'µmol/L');
  await page.fill(fid('egfr', 'creatinine'), '97.24');
  await calcBtn(); await sheet();
  check('µmol/L unit works', /^81\.[78]$/.test(await primary()), await primary());
  await closeSheet();

  await seg('egfr', 'Equation', '2009');
  check('race switch appears for 2009', await vis(fid('egfr', 'race')));
  await page.locator('#page-egfr .switch-row').click();
  await seg('egfr', 'Serum creatinine', 'mg/dL');
  await page.fill(fid('egfr', 'creatinine'), '1.1');
  await calcBtn(); s = await sheet();
  check('2009 + race = 90.2', (await primary()) === '90.2' && /race factor/.test(s), s);
  await closeSheet();

  await seg('egfr', 'Equation', '2021');
  check('race switch hides again', !(await vis(fid('egfr', 'race'))));

  console.log('Validation + input handling');
  await page.fill(fid('egfr', 'creatinine'), '');
  await calcBtn();
  await page.waitForSelector('#page-egfr .error:not([hidden])');
  check('empty field -> inline "required" error', /required/.test(await txt('#page-egfr .error:not([hidden])')));
  check('field is focused + flagged', await page.evaluate(() => document.activeElement.id === 'page-egfr-creatinine' && document.activeElement.getAttribute('aria-invalid') === 'true'));
  check('no result sheet opened on error', !(await vis('.sheet.show')));
  await page.fill(fid('egfr', 'creatinine'), '0'); await calcBtn();
  check('zero rejected', /greater than 0|too low/.test(await txt('#page-egfr .error:not([hidden])')));
  await page.fill(fid('egfr', 'creatinine'), '1.1');
  check('error clears when typing', (await page.locator('#page-egfr .error:not([hidden])').count()) === 0);
  await page.fill(fid('egfr', 'creatinine'), 'abc1.1');
  check('letters are stripped as you type', (await page.inputValue(fid('egfr', 'creatinine'))) === '1.1');
  await page.fill(fid('egfr', 'creatinine'), '১.১');
  await calcBtn(); await sheet();
  check('Bengali digits accepted (১.১ -> 1.1)', (await primary()) === '81.8', await primary());
  await closeSheet();
  await page.fill(fid('egfr', 'creatinine'), '1,1');
  await calcBtn(); await sheet();
  check('decimal comma accepted', (await primary()) === '81.8');
  await closeSheet();

  console.log('Keyboard flow');
  await page.fill(fid('egfr', 'creatinine'), ''); await page.fill(fid('egfr', 'age'), '');
  await page.focus(fid('egfr', 'creatinine')); await page.keyboard.type('1.1'); await page.keyboard.press('Enter');
  check('Enter moves to next empty field', await page.evaluate(() => document.activeElement.id === 'page-egfr-age'));
  await page.keyboard.type('50'); await page.keyboard.press('Enter');
  await sheet();
  check('Enter on last field calculates', (await primary()) === '81.8');
  check('enterkeyhint: next / done', (await page.getAttribute(fid('egfr', 'creatinine'), 'enterkeyhint')) === 'next' && (await page.getAttribute(fid('egfr', 'age'), 'enterkeyhint')) === 'done');
  await closeSheet();

  console.log('Result actions');
  await page.click('.page.open [data-back]'); // placeholder to ensure back works
  await page.waitForFunction(() => !document.querySelector('.page.open'));
  check('Back returns to the list', (await hash()) === '#/' || (await hash()) === '');
  await openCalc('egfr');
  await calcBtn(); await sheet();
  await page.click('.sheet .btn.outline');
  await page.waitForSelector('#toast.show');
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  check('Copy puts result + inputs on the clipboard', /MediCalc Pro · eGFR/.test(clip) && /eGFR: 81\.8 mL\/min\/1\.73 m²/.test(clip) && /Serum creatinine: 1\.1 mg\/dL/.test(clip), clip);
  check('Share hidden when the platform has no share API', (await page.locator('.sheet .btn.outline').count()) === 1);
  // swipe down to dismiss
  const h = await page.locator('.sheet-handle').boundingBox();
  await page.mouse.move(h.x + h.width / 2, h.y + 2); await page.mouse.down();
  await page.mouse.move(h.x + h.width / 2, h.y + 160, { steps: 6 }); await page.mouse.up();
  await page.waitForFunction(() => !document.querySelector('.sheet.show'));
  check('swipe down dismisses the sheet', (await hash()) === '#/c/egfr');
  await back();

  console.log('All 17 calculators through the real UI');
  const T = [
    ['pt-inr', { patient: 13.4, control: 12 }, '1.12'],
    ['hema-abs', { wbc: 6.5, neut: 60, lymph: 30 }, '3.90'],
    ['crcl', { creatinine: 1.2, weight: 70, age: 60 }, '64.8'],
    ['ccr', { urineCreatinine: 100, serumCreatinine: 1.0, volume: 1440, height: 170, weight: 70 }, '95.60', async () => seg('ccr', 'Height', 'cm')],
    ['urine-acr', { albumin: 30, creatinine: 0.8 }, '37.5'],
    ['urine-pcr', { protein: 15, creatinine: 50 }, '300.0'],
    ['uprotein-24', { conc: 150, vol: 1500 }, '2250'],
    ['urine-osm', { na: 60, k: 30, urea: 600 }, '279.9'],
    ['serum-osm', { na: 140, glucose: 5.5, urea: 14 }, '299.5', async () => seg('serum-osm', 'Urea or BUN', 'Urea mmol/L')],
    ['anion-gap', { na: 140, cl: 104, hco3: 24 }, '12.00'],
    ['ckmb-index', { total: 300, mb: 10 }, '3.33'],
    ['homa-ir', { glucose: 100, insulin: 10 }, '2.469'],
    ['free-test', { total: 400, shbg: 30, albumin: 4.0 }, '303.68', async () => seg('free-test', 'Total testosterone', 'ng/dL')],
    ['ft-index', { uptake: 30, t4: 8 }, '2.40'],
  ];
  for (const [id, vals, expect, pre] of T) {
    await openCalc(id);
    if (pre) await pre();
    await fill(id, vals);
    await calcBtn(); await sheet();
    check(`${id} -> ${expect}`, (await primary()) === expect, await primary());
    await closeSheet(); await back();
  }
  // calculators without a headline number
  await openCalc('uelectro-24'); await fill('uelectro-24', { na: 120, vol: 1500 }); await calcBtn(); s = await sheet();
  check('uelectro-24 -> Na 180.0 mmol/day, no K row', /Na⁺ excretion180\.0 mmol\/day/.test(s) && !/K⁺ excretion/.test(s), s);
  check('no readout block when there is no primary value', (await page.locator('.sheet .num-xl').count()) === 0);
  await closeSheet(); await back();
  await openCalc('thyroid'); await fill('thyroid', { ft4: 1.2 }); await calcBtn(); s = await sheet();
  check('thyroid -> 15.44 pmol/L', /1\.2 ng\/dL = 15\.44 pmol\/L/.test(s), s);
  await closeSheet(); await seg('thyroid', 'Free T4', 'pmol/L'); await page.fill(fid('thyroid', 'ft4'), '15.444'); await calcBtn(); s = await sheet();
  check('thyroid reverse -> 1.20 ng/dL', /= 1\.20 ng\/dL/.test(s), s);
  await closeSheet(); await back();

  // dependent fields
  await openCalc('anion-gap');
  check('K field hidden by default', !(await vis(fid('anion-gap', 'k'))));
  await seg('anion-gap', 'Potassium', 'Include K⁺');
  check('K field appears', await vis(fid('anion-gap', 'k')));
  await fill('anion-gap', { na: 140, cl: 104, hco3: 24 });
  await calcBtn();
  await page.waitForSelector('#page-anion-gap .error:not([hidden])');
  check('Include K with K blank -> helpful error', /K⁺ is required/.test(await txt('#page-anion-gap .error:not([hidden])')));
  await fill('anion-gap', { k: 4.2 }); await calcBtn(); await sheet();
  check('anion gap with K = 16.20', (await primary()) === '16.20');
  await closeSheet(); await back();
  await openCalc('ft-index');
  check('T3 field hidden for FT4 index', !(await vis(fid('ft-index', 't3'))));
  await seg('ft-index', 'Index', 'FT3 index');
  check('T3 shown, T4 hidden after switching', (await vis(fid('ft-index', 't3'))) && !(await vis(fid('ft-index', 't4'))));
  await fill('ft-index', { uptake: 30, t3: 120 }); await calcBtn(); await sheet();
  check('FT3 index = 36.00', (await primary()) === '36.00');
  await closeSheet(); await back();

  // ACR sheet screenshot + stage logic
  await openCalc('urine-acr'); await fill('urine-acr', { albumin: 30, creatinine: 0.8 });
  await calcBtn(); s = await sheet();
  check('ACR 37.5 mg/g is A2 (not A3)', /A2 · Moderately increased/.test(s) && (await page.locator('.scale-item.on .scale-code').textContent()) === 'A2', s);
  await page.waitForTimeout(450); await page.screenshot({ path: SHOTS + '/04-result-acr.png' });
  await closeSheet();
  await page.fill(fid('urine-acr', 'albumin'), '16'); await calcBtn(); await sheet();
  check('ACR 20 mg/g is A1', /A1/.test(await txt('.sheet .tone-chip')));
  await closeSheet(); await back();

  // reset restores defaults
  await openCalc('pt-inr'); await fill('pt-inr', { patient: 20, control: 11, isi: 1.4 });
  await page.click('.page.open .btn.ghost');
  check('Reset restores ISI = 1.0 and clears the rest', (await page.inputValue(fid('pt-inr', 'isi'))) === '1.0' && (await page.inputValue(fid('pt-inr', 'patient'))) === '');
  await back();
  await openCalc('ccr'); await seg('ccr', 'Height', 'cm');
  await page.click('.page.open .btn.ghost');
  check('Reset restores hours = 24 and first unit (ft)', (await page.inputValue(fid('ccr', 'hours'))) === '24' && /true/.test(await page.locator('#page-ccr .field', { hasText: 'Height' }).locator('button[role=radio]').first().getAttribute('aria-checked')));
  await back();

  console.log('Stray text');
  const ALL_IDS = ['pt-inr','hema-abs','egfr','crcl','ccr','urine-acr','urine-pcr','uprotein-24','uelectro-24','urine-osm','serum-osm','anion-gap','ckmb-index','homa-ir','thyroid','free-test','ft-index'];
  let stray = [];
  for (const id of ALL_IDS) {
    await openCalc(id);
    const t = await page.evaluate((pid) => document.getElementById('page-' + pid).textContent, id);
    if (/null|undefined|NaN|\[object/.test(t)) stray.push(id);
    await back();
  }
  check('no stray "null"/"undefined"/"NaN" text in any of the 17 forms', stray.length === 0, stray.join(','));
  const rowsText = await page.evaluate(() => document.getElementById('view-home').textContent);
  check('home list has no truncated-description overflow (descriptions fit)', await page.evaluate(() => [...document.querySelectorAll('.row-desc')].every((e) => e.scrollWidth <= e.clientWidth + 1)));

  console.log('Favorites, recents, settings');
  await openCalc('egfr');
  await page.click('#page-egfr .star');
  check('star toggles on', (await page.getAttribute('#page-egfr .star', 'aria-pressed')) === 'true');
  await back();
  check('star state reflected in the list', (await page.getAttribute('#view-home [data-fav="egfr"]', 'aria-pressed')) === 'true');
  check('recents row shows visited calculators', (await page.locator('#view-home .recent').count()) >= 3);
  await page.click('.tab[data-tab="favorites"]');
  check('Favorites tab lists eGFR', (await page.locator('#view-favorites .row-title').allTextContents()).join() === 'eGFR');
  await page.screenshot({ path: SHOTS + '/05-favorites.png' });
  await page.click('#view-favorites .star');
  check('un-starring empties Favorites', await vis('#view-favorites .empty'));
  await page.click('#view-favorites .empty', { trial: true }).catch(() => {});
  await page.click('.tab[data-tab="home"]'); await page.click('#view-home [data-fav="egfr"]');
  await page.click('.tab[data-tab="settings"]');
  await page.screenshot({ path: SHOTS + '/06-settings.png' });
  check('settings shows subscription status', /Active until December 31, 2026 \(46 days left\)/.test(await txt('#view-settings')), (await txt('#view-settings')).slice(0, 400));

  console.log('Theme');
  await page.locator('#view-settings .seg button', { hasText: 'Dark' }).click();
  check('dark theme applied', (await page.getAttribute('html', 'data-theme')) === 'dark');
  await page.click('.tab[data-tab="home"]');
  await page.screenshot({ path: SHOTS + '/07-home-dark.png' });
  await openCalc('egfr'); await calcBtn(); await sheet(); await page.waitForTimeout(450);
  await page.screenshot({ path: SHOTS + '/08-result-dark.png' });
  await closeSheet(); await back();
  await page.reload(); await page.waitForSelector('.row');
  check('theme + favorites persist across reload', (await page.getAttribute('html', 'data-theme')) === 'dark' && (await page.getAttribute('#view-home [data-fav="egfr"]', 'aria-pressed')) === 'true');
  await page.click('.tab[data-tab="settings"]');
  await page.locator('#view-settings .seg button', { hasText: 'Light' }).click();
  await page.click('#clear-data');
  check('Clear data removes favorites', (await page.getAttribute('#view-home [data-fav="egfr"]', 'aria-pressed')) === 'false');
  await page.click('.tab[data-tab="home"]');

  console.log('Responsive + safe areas');
  for (const [w, hh] of [[360, 740], [412, 915], [768, 1024]]) {
    await page.setViewportSize({ width: w, height: hh });
    const ids = ['egfr', 'ccr', 'serum-osm', 'thyroid'];
    let ok = true;
    for (const id of ids) {
      await openCalc(id);
      ok = ok && await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth && document.querySelector('.page-scroll').scrollWidth <= document.querySelector('.page-scroll').clientWidth);
      await back();
    }
    check(`no horizontal overflow at ${w}px (home + 4 forms)`, ok && await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));
  }
  await page.setViewportSize({ width: 412, height: 915 });
  await openCalc('ccr');
  const small = await page.evaluate(() => {
    const bad = [];
    document.querySelectorAll('.page.open button, .page.open input[type=text]').forEach((el) => {
      if (el.offsetParent === null) return;
      const r = el.getBoundingClientRect();
      if (r.height < 44 || r.width < 44) bad.push(`${el.className || el.id} ${Math.round(r.width)}x${Math.round(r.height)}`);
    });
    return bad;
  });
  check('all buttons and inputs are at least 44px (touch targets)', small.length === 0, small.join('; '));
  await page.waitForTimeout(450);
  await page.screenshot({ path: SHOTS + '/09-form-long.png' });
  await back();
  await page.addStyleTag({ content: ':root{--safe-area-inset-top:34px;--safe-area-inset-bottom:26px}' });
  const insets = await page.evaluate(() => ({
    brandTop: document.querySelector('.brand').getBoundingClientRect().top + parseFloat(getComputedStyle(document.querySelector('.brand')).paddingTop),
    tabbarH: Math.round(document.querySelector('.tabbar').getBoundingClientRect().height),
    fill: document.querySelector('.statusfill').getBoundingClientRect().height
  }));
  check('safe-area insets respected (status bar fill 34px, tab bar 62+26px)', insets.fill === 34 && insets.tabbarH === 88, JSON.stringify(insets));
  await openCalc('egfr');
  const barTop = await page.evaluate(() => document.querySelector('.page.open .page-title').getBoundingClientRect().top);
  check('page title sits below the status bar inset', barTop >= 34, String(barTop));
  await page.waitForTimeout(450);
  await page.screenshot({ path: SHOTS + '/10-insets.png' });
  await back();

  console.log('Subscription lock');
  const lockCtx = await mk();
  await lockCtx.page.clock.install({ time: new Date('2027-01-05T10:00:00') });
  await lockCtx.page.goto(BASE); await lockCtx.page.waitForSelector('.row');
  check('lock shows after expiry', await lockCtx.page.isVisible('#lock'));
  check('app is inert behind the lock (backdrop blur on the lock)', await lockCtx.page.evaluate(() => document.getElementById('app').inert && getComputedStyle(document.getElementById('lock')).backdropFilter.includes('blur')));
  check('contact button is tappable (not covered)', await lockCtx.page.evaluate(() => { const b = document.getElementById('lock-contact').getBoundingClientRect(); return document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2).id === 'lock-contact'; }));
  check('lock covers the tab bar (taps blocked)', await lockCtx.page.evaluate(() => { const b = document.querySelector('.tab[data-tab="settings"]').getBoundingClientRect(); return !!document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2).closest('#lock'); }));
  await lockCtx.page.screenshot({ path: SHOTS + '/11-lock.png' });
  const bannerCtx = await mk();
  await bannerCtx.page.clock.install({ time: new Date('2026-12-25T10:00:00') });
  await bannerCtx.page.goto(BASE); await bannerCtx.page.waitForSelector('.row');
  check('renewal banner within 14 days', /ends in 7 days/.test(await bannerCtx.page.textContent('#home-banner')), await bannerCtx.page.textContent('#home-banner'));
  const lateCtx = await mk();
  await lateCtx.page.clock.install({ time: new Date('2026-12-31T23:30:00') });
  await lateCtx.page.goto(BASE); await lateCtx.page.waitForSelector('.row');
  check('still active on the last day', !(await lateCtx.page.isVisible('#lock')));
  await lateCtx.page.clock.fastForward('01:00:00'); await lateCtx.page.clock.runFor(61000);
  check('locks itself once the day ends', await lateCtx.page.isVisible('#lock'));

  console.log('Dark by system + offline PWA');
  const dark = await mk({ colorScheme: 'dark' });
  await dark.page.goto(BASE); await dark.page.waitForSelector('.row');
  check('follows system dark mode by default', (await dark.page.getAttribute('html', 'data-theme')) === 'dark');
  const pwa = await mk();
  await pwa.page.goto(BASE); await pwa.page.waitForSelector('.row');
  await pwa.page.evaluate(() => navigator.serviceWorker.ready);
  await pwa.page.reload(); await pwa.page.waitForSelector('.row');
  check('service worker is controlling the page', await pwa.page.evaluate(() => !!navigator.serviceWorker.controller));
  await pwa.ctx.setOffline(true);
  await pwa.page.reload(); await pwa.page.waitForSelector('.row');
  check('app loads fully while offline', (await pwa.page.locator('#view-home .row').count()) === 17 && await pwa.page.evaluate(() => document.fonts.check('600 16px "MC Sans"')));
  await pwa.page.click('[data-open="pt-inr"]'); await pwa.page.fill('#page-pt-inr-patient', '13.4'); await pwa.page.fill('#page-pt-inr-control', '12');
  await pwa.page.click('.page.open .btn.primary'); await pwa.page.waitForSelector('.sheet.show');
  check('calculates offline', (await pwa.page.textContent('.sheet .num-xl')) === '1.12');
  const man = await pwa.ctx.request.get(BASE.replace('index.html', 'manifest.webmanifest')).catch(() => null);
  await pwa.ctx.setOffline(false);
  const m = await (await pwa.ctx.request.get(BASE.replace('index.html', 'manifest.webmanifest'))).json();
  const iconOk = await Promise.all(m.icons.map(async (i) => (await pwa.ctx.request.get(BASE.replace('index.html', '') + i.src)).ok()));
  check('manifest icons all resolve', iconOk.every(Boolean) && m.display === 'standalone');

  console.log('Console');
  const all = [...errors, ...lockCtx.errors, ...bannerCtx.errors, ...dark.errors];
  check('no console/page errors', all.length === 0, JSON.stringify(all.slice(0, 5)));

  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close();
  server.close();
  process.exit(fail ? 1 : 0);
});
server.on('error', (e) => { console.error(e); process.exit(2); });
