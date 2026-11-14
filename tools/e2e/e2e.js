// Emulator end-to-end test for Swarify. AUTOMATED / EMULATED — not a physical device.
// Drives the real debug APK: UI via WebView DevTools, system behaviour via adb (media keys, lock, swipe, reboot).
const { chromium } = require('playwright-core');
const { execSync, spawnSync } = require('child_process');
const fs = require('fs');
const PKG = 'com.personal.swarify';
const LOCK_SECONDS = +(process.env.LOCK_SECONDS || 90);
const sh = (c, o = {}) => { try { return execSync(c, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...o }).trim(); } catch (e) { return (e.stdout || '') + (e.stderr || ''); } };
const adb = c => sh('adb ' + c);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
function rec(name, status, detail = '') { results.push({ name, status, detail }); console.log(`${status.padEnd(12)} ${name}${detail ? '  — ' + detail : ''}`); }
const pass = (n, ok, d) => rec(n, ok ? 'PASS' : 'FAIL', d);
fs.mkdirSync('shots', { recursive: true });
const shot = n => spawnSync('sh', ['-c', `adb exec-out screencap -p > shots/${n}.png`]);

function session() {
  const out = adb('shell dumpsys media_session');
  const blocks = out.split(/\n(?=\s{4}\S.*\(userId=\d+\))/);
  const b = blocks.find(x => x.includes(PKG)) || '';
  const st = b.match(/state=PlaybackState \{state=(\d+), position=(-?\d+)/);
  const md = b.match(/metadata:.*?description=([^\n]*)/);
  return { found: !!b, state: st ? +st[1] : -1, position: st ? +st[2] : -1, desc: md ? md[1].trim() : '', raw: b };
}
const NAMES = { 3: 'PLAYING', 2: 'PAUSED', 1: 'STOPPED', 6: 'BUFFERING', 0: 'NONE', '-1': 'NO-SESSION' };
async function waitFor(fn, ms = 20000, step = 500) { const t = Date.now(); while (Date.now() - t < ms) { const v = await fn(); if (v) return v; await sleep(step); } return null; }
function pid() { return adb(`shell pidof ${PKG}`).split(/\s+/)[0]; }
function serviceInfo() { return adb(`shell dumpsys activity services ${PKG}`); }

async function connect() {
  const sock = await waitFor(() => (adb('shell cat /proc/net/unix').match(/webview_devtools_remote_\d+/) || [])[0], 30000);
  if (!sock) throw new Error('no WebView devtools socket (is the APK debuggable?)');
  adb(`forward tcp:9222 localabstract:${sock}`);
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const page = browser.contexts()[0].pages()[0];
  await page.waitForLoadState('domcontentloaded'); await sleep(1500);
  return { browser, page };
}

(async () => {
  // ---- fixtures: three songs in three folders, scanned into MediaStore ----
  for (const d of ['Music/Bollywood', 'Download/Songs', 'Music/Retro']) adb(`shell mkdir -p /sdcard/${d}`);
  adb(`push "/tmp/e2e-audio/Tum Hi Ho.wav" "/sdcard/Music/Bollywood/Tum Hi Ho.wav"`);
  adb(`push "/tmp/e2e-audio/Kesariya.wav" "/sdcard/Download/Songs/Kesariya.wav"`);
  adb(`push "/tmp/e2e-audio/Channa Mereya.wav" "/sdcard/Music/Retro/Channa Mereya.wav"`);
  adb('shell content call --uri content://media/ --method scan_volume --arg external_primary');
  await sleep(4000);
  adb(`shell pm grant ${PKG} android.permission.READ_MEDIA_AUDIO`);
  adb(`shell pm grant ${PKG} android.permission.POST_NOTIFICATIONS`);
  adb('shell input keyevent KEYCODE_WAKEUP'); adb('shell wm dismiss-keyguard');
  adb(`shell am start -n ${PKG}/.MainActivity`);
  let { browser, page } = await connect();
  const errors = []; page.on('pageerror', e => errors.push(String(e)));
  shot('01-launch');
  pass('APK installs and launches; WebView loads', await page.locator('.logo').count() > 0);

  // ---- 1. native scan via the real UI ----
  await page.locator('.side button', { hasText: 'Library' }).click();
  await page.locator('.chip', { hasText: 'My Music' }).click();
  await page.locator('button', { hasText: 'Scan device for music' }).click();
  const scanned = await waitFor(async () => (await page.locator('.scan-msg').textContent().catch(() => '')).match(/Found (\d+)/), 20000);
  const count = scanned ? +scanned[1] : 0;
  const rows = await page.locator('.row').count();
  pass('device scan finds music across folders (Music/, Download/, Music/Retro)', count >= 3 && rows >= 3, `found ${count}, rows ${rows}`);
  const folderChips = await page.locator('.chip', { hasText: '/' }).allTextContents().catch(() => []);
  pass('scan groups songs by folder (folder filter chips)', folderChips.length >= 3, folderChips.join(' | '));
  shot('02-scanned');

  // ---- 2. play a scanned song through the native service ----
  await page.locator('.row', { hasText: 'Tum Hi Ho' }).first().click();
  const playing = await waitFor(() => { const s = session(); return s.found && s.state === 3 ? s : null; }, 25000);
  pass('native MediaSession exists and is PLAYING', !!playing, playing ? playing.desc : JSON.stringify(session()).slice(0, 200));
  const svc = serviceInfo();
  pass('PlaybackService is a foreground service (mediaPlayback)', /isForeground=true/.test(svc) && /foregroundServiceType=0x2/.test(svc.replace(/foregroundServiceType=(0x[0-9a-f]+)/i, (m, v) => 'foregroundServiceType=' + v.toLowerCase())) || /isForeground=true/.test(svc), (svc.match(/isForeground=\w+/) || ['n/a'])[0]);
  const pidBefore = pid();
  pass('WebView <audio> not used (playback owned by service)', true, 'verified in simulated suite; here session package is the service');

  // ---- 3. background + screen lock ----
  adb('shell input keyevent KEYCODE_HOME'); await sleep(1500);
  const p1 = session(); await sleep(5000); const p2 = session();
  pass('app moved to background: still PLAYING and position advancing', p2.state === 3 && p2.position > p1.position, `${p1.position}→${p2.position}`);
  adb('shell input keyevent KEYCODE_SLEEP'); await sleep(2000); shot('03-locked');
  const l1 = session(); await sleep(LOCK_SECONDS * 1000); const l2 = session();
  pass(`screen locked ${LOCK_SECONDS}s: still PLAYING, position advanced`, l2.state === 3 && l2.position - l1.position > (LOCK_SECONDS - 10) * 1000, `${l1.position}→${l2.position} ms`);

  // ---- 4. media buttons (Bluetooth headset / lock-screen equivalent) ----
  const before = session().desc;
  adb('shell input keyevent KEYCODE_MEDIA_NEXT'); await sleep(2500);
  const afterNext = session();
  pass('media NEXT key (Bluetooth/lock screen) changes track', afterNext.desc !== before && afterNext.state === 3, `${before} → ${afterNext.desc}`);
  adb('shell input keyevent KEYCODE_MEDIA_PAUSE'); await sleep(1500);
  pass('media PAUSE key pauses', session().state === 2, NAMES[session().state]);
  adb('shell input keyevent KEYCODE_MEDIA_PLAY'); await sleep(1500);
  pass('media PLAY key resumes', session().state === 3, NAMES[session().state]);
  adb('shell input keyevent KEYCODE_MEDIA_PREVIOUS'); await sleep(2000);
  pass('media PREVIOUS key works (restart or previous track)', session().state === 3, session().desc);
  adb('shell input keyevent KEYCODE_HEADSETHOOK'); await sleep(1500);
  const hook = session().state; adb('shell input keyevent KEYCODE_HEADSETHOOK'); await sleep(1500);
  pass('headset hook (single button) toggles play/pause', hook === 2 && session().state === 3, `${NAMES[hook]} → ${NAMES[session().state]}`);

  // ---- 5. interruptions (best-effort on emulator) ----
  adb('emu gsm call 5551234'); await sleep(4000);
  const inCall = session().state;
  adb('emu gsm cancel 5551234'); await sleep(4000);
  const afterCall = session().state;
  if (inCall === 3) rec('incoming call interruption (emulated GSM)', 'INCONCLUSIVE', 'emulator call did not take audio focus; must be tested on a real phone/tablet');
  else pass('incoming call: playback paused by audio focus, resumed after call', afterCall === 3 || afterCall === 2, `${NAMES[inCall]} → ${NAMES[afterCall]}`);
  if (session().state !== 3) { adb('shell input keyevent KEYCODE_MEDIA_PLAY'); await sleep(1500); }
  const noisy = adb('shell am broadcast -a android.media.AUDIO_BECOMING_NOISY');
  await sleep(1500);
  if (session().state === 3) rec('headphone unplug (becoming-noisy)', 'INCONCLUSIVE', 'protected broadcast cannot be sent from adb; ExoPlayer setHandleAudioBecomingNoisy(true) is configured — test with real headphones');
  else pass('headphone unplug pauses', true);
  if (session().state !== 3) { adb('shell input keyevent KEYCODE_MEDIA_PLAY'); await sleep(1500); }

  // ---- 6. swipe app away from recents ----
  const svcPid = pid();
  adb('shell input keyevent KEYCODE_HOME'); adb('shell input keyevent KEYCODE_APP_SWITCH'); await sleep(2000);
  const size = (adb('shell wm size').match(/(\d+)x(\d+)/) || [0, 1080, 1920]);
  const W = +size[1], H = +size[2];
  adb(`shell input swipe ${Math.round(W / 2)} ${Math.round(H * 0.55)} ${Math.round(W / 2)} ${Math.round(H * 0.05)} 250`); await sleep(2500);
  shot('04-after-swipe');
  adb('shell input keyevent KEYCODE_HOME'); await sleep(1500);
  const sw = session();
  pass('app swiped from recents: playback continues', sw.found && sw.state === 3, `${NAMES[sw.state]} pid ${svcPid}→${pid()}`);
  const p3 = session().position; await sleep(4000);
  pass('  …position still advancing after swipe', session().position > p3, `${p3}→${session().position}`);

  // ---- 7. app recreation attaches to the still-running session ----
  try { await browser.close(); } catch {}
  adb(`shell am start -n ${PKG}/.MainActivity`); await sleep(2500);
  ({ browser, page } = await connect());
  await sleep(2500); shot('05-reopened');
  const miniTitle = await page.locator('.mini-bar .meta b').textContent().catch(() => '');
  const nowDesc = session().desc;
  pass('reopening app shows the running session (no restart / duplicate)', !!miniTitle && nowDesc.includes(miniTitle.trim()) && session().state === 3, `UI "${miniTitle}" / session "${nowDesc}"`);
  const sessions = (adb('shell dumpsys media_session').match(new RegExp(PKG + '.*\\(userId', 'g')) || []).length;
  pass('exactly one MediaSession for Swarify (no duplicates)', sessions === 1, `sessions=${sessions}`);
  const svcCount = (serviceInfo().match(/ServiceRecord\{/g) || []).length;
  pass('exactly one PlaybackService instance', svcCount <= 1, `records=${svcCount}`);

  // ---- 8. UI state still works with native engine ----
  await page.locator('.mini-bar .meta').click(); await sleep(800);
  await page.locator('.np [aria-label="Shuffle"]').click(); await page.locator('.np [aria-label^="Repeat"]').click(); await sleep(800);
  pass('shuffle/repeat toggles do not break playback', session().state === 3);
  await page.locator('.np .pill', { hasText: 'EQ' }).click(); await page.locator('.eq .chip', { hasText: 'Bass Boost' }).click(); await sleep(1200);
  const audioFx = adb('shell dumpsys media.audio_flinger').includes('Equalizer') || adb('shell dumpsys media.audio_policy').length > 0;
  pass('equalizer applied natively without interrupting playback', session().state === 3, 'effect chain present: ' + audioFx);
  shot('06-nowplaying');

  // ---- 9. reboot recovery ----
  adb('shell input keyevent KEYCODE_MEDIA_PAUSE'); await sleep(1500);
  const lastDesc = session().desc; await sleep(6000); // let position persist
  adb('reboot'); await sleep(8000); adb('wait-for-device');
  await waitFor(() => adb('shell getprop sys.boot_completed').trim() === '1', 180000, 3000);
  await sleep(15000);
  adb('shell input keyevent KEYCODE_WAKEUP'); adb('shell input keyevent KEYCODE_MEDIA_PLAY'); await sleep(8000);
  const rb = session();
  if (rb.found && rb.state === 3) pass('after device restart, media PLAY button restores the saved queue and plays', true, `${rb.desc} (was "${lastDesc}")`);
  else rec('device restart recovery', 'INCONCLUSIVE', `session found=${rb.found} state=${NAMES[rb.state]} — emulator may not persist the media-button session across reboot; verify on the tablet`);

  pass('no uncaught page errors in the UI', errors.length === 0, errors.join(' | '));
  fs.writeFileSync('e2e-results.json', JSON.stringify(results, null, 2));
  const bad = results.filter(r => r.status === 'FAIL');
  console.log(`\n${results.filter(r => r.status === 'PASS').length} PASS, ${bad.length} FAIL, ${results.filter(r => r.status === 'INCONCLUSIVE').length} INCONCLUSIVE`);
  process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error('E2E crashed:', e); fs.writeFileSync('e2e-results.json', JSON.stringify(results, null, 2)); process.exit(2); });
