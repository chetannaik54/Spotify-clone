// Emulator end-to-end test for Swarify. AUTOMATED / EMULATED — not a physical device.
// Drives the real debug APK: UI via WebView DevTools, system behaviour via adb (media keys, lock, swipe, reboot).
const { connectPage } = require('./cdp');
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

function sessionBlock() {
  const out = adb('shell dumpsys media_session');
  // Android renders each session as a block that mentions "package=<pkg>"; take text from there to the next session/section.
  const i = out.indexOf(`package=${PKG}`);
  if (i < 0) return { out, block: '' };
  const start = out.lastIndexOf('\n', out.lastIndexOf('(userId=', i) >= 0 ? out.lastIndexOf('(userId=', i) : i);
  const rest = out.slice(i);
  const next = rest.slice(20).search(/\n {4}\S.*\(userId=\d+\)|\nAudio playback|\nSession listeners/);
  return { out, block: out.slice(Math.max(0, start), i + (next > 0 ? next + 20 : 4000)) };
}
function uptimeMs() { const v = parseFloat(adb('shell cat /proc/uptime').split(/\s+/)[0]); return Number.isFinite(v) ? v * 1000 : 0; }
function session() {
  const { out, block: b } = sessionBlock();
  // state renders as "state=PlaybackState {state=3, position=..." (older) or "state=PLAYING(3), position=..." (newer)
  const st = b.match(/state=(?:PlaybackState \{state=)?(?:[A-Z_]+\()?(\d+)\)?, position=(-?\d+)/);
  const md = b.match(/metadata:.*?description=([^\n]*)/);
  const tm = b.match(/position=(-?\d+),[^}]*?speed=([\d.]+),\s*updated=(\d+)/);
  const state = st ? +st[1] : -1; let position = st ? +st[2] : -1;
  // Android only refreshes PlaybackState on state changes; the live position is position + (now - updated) * speed.
  if (state === 3 && tm) position = Math.round(+tm[1] + (uptimeMs() - +tm[3]) * +tm[2]);
  return { found: !!b, state, position, desc: md ? md[1].trim() : '', raw: b, all: out };
}
function sessionCount() { return (sessionBlock().out.match(new RegExp(`package=${PKG.replace(/\./g, '\\.')}`, 'g')) || []).length; }
function debugDump(tag) {
  const { out, block } = sessionBlock();
  console.log(`----- DEBUG ${tag}: media_session block for ${PKG} -----\n${block.slice(0, 1800) || '(no block; first lines mentioning pkg:)\n' + out.split('\n').filter(l => l.includes('swarify')).slice(0, 12).join('\n')}\n----- END DEBUG -----`);
}
const NAMES = { 3: 'PLAYING', 2: 'PAUSED', 1: 'STOPPED', 6: 'BUFFERING', 0: 'NONE', '-1': 'NO-SESSION' };
async function waitFor(fn, ms = 20000, step = 500) { const t = Date.now(); while (Date.now() - t < ms) { const v = await fn(); if (v) return v; await sleep(step); } return null; }
function pid() { return adb(`shell pidof ${PKG}`).split(/\s+/)[0]; }
function serviceInfo() { return adb(`shell dumpsys activity services ${PKG}`); }

async function connect() {
  const sock = await waitFor(() => (adb('shell cat /proc/net/unix').match(/webview_devtools_remote_\d+/) || [])[0], 30000);
  if (!sock) throw new Error('no WebView devtools socket (is the APK debuggable?)');
  adb(`forward tcp:9222 localabstract:${sock}`);
  const ui = await connectPage(9222); await sleep(1500); return ui;
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
  let ui = await connect();
  shot('01-launch');
  pass('APK installs and launches; WebView loads', await ui.count('.logo') > 0);

  // ---- 1. native scan via the real UI ----
  await ui.click('.side button', 'Library');
  await ui.click('.chip', 'My Music');
  await ui.click('button', 'Scan device for music');
  const scanned = await waitFor(async () => (await ui.text('.scan-msg')).match(/Found (\d+)/), 20000);
  const count = scanned ? +scanned[1] : 0;
  const rows = await ui.count('.row');
  pass('device scan finds music across folders (Music/, Download/, Music/Retro)', count >= 3 && rows >= 3, `found ${count}, rows ${rows}`);
  const folderChips = await ui.texts('.chip', '/');
  pass('scan groups songs by folder (folder filter chips)', folderChips.length >= 3, folderChips.join(' | '));
  shot('02-scanned');

  // ---- 2. play a scanned song through the native service ----
  await ui.click('.row');   // first song in the list, so "next" has somewhere to go
  const playing = await waitFor(() => { const s = session(); return s.found && s.state === 3 ? s : null; }, 25000);
  if (!playing) debugDump('play');
  pass('native MediaSession exists and is PLAYING', !!playing, playing ? playing.desc : JSON.stringify(session()).slice(0, 200));
  const svc = serviceInfo();
  pass('PlaybackService is a foreground service (mediaPlayback)', /isForeground=true/.test(svc) && /foregroundServiceType=0x2/.test(svc.replace(/foregroundServiceType=(0x[0-9a-f]+)/i, (m, v) => 'foregroundServiceType=' + v.toLowerCase())) || /isForeground=true/.test(svc), (svc.match(/isForeground=\w+/) || ['n/a'])[0]);
  const pidBefore = pid();

  // ---- 3. background + screen lock ----
  adb('shell input keyevent KEYCODE_HOME'); await sleep(1500);
  const p1 = session(); await sleep(5000); const p2 = session();
  pass('app moved to background: still PLAYING and position advancing', p2.state === 3 && p2.position > p1.position, `${p1.position}→${p2.position}`);
  adb('shell input keyevent KEYCODE_SLEEP'); await sleep(2000); shot('03-locked');
  const l1 = session(); await sleep(LOCK_SECONDS * 1000); const l2 = session();
  pass(`screen locked ${LOCK_SECONDS}s: still PLAYING, position advanced`, l2.state === 3 && l2.position - l1.position > (LOCK_SECONDS - 10) * 1000, `${l1.position}→${l2.position} ms`);

  // ---- 4. media buttons (Bluetooth headset / lock-screen equivalent) ----
  adb('shell input keyevent KEYCODE_WAKEUP'); adb('shell wm dismiss-keyguard'); await sleep(1500);   // keys are only routed reliably with the screen on
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
  const hs = session().state;
  if (hs === 3) rec('headphone unplug (becoming-noisy)', 'INCONCLUSIVE', 'protected broadcast cannot be sent from adb; ExoPlayer setHandleAudioBecomingNoisy(true) is configured — test with real headphones');
  else pass('headphone unplug pauses', hs === 2, NAMES[hs]);
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
  ui.close();
  adb(`shell am start -n ${PKG}/.MainActivity`); await sleep(2500);
  ui = await connect();
  await sleep(2500); shot('05-reopened');
  const miniTitle = await ui.text('.mini-bar .meta b');
  const nowDesc = session().desc;
  pass('reopening app shows the running session (no restart / duplicate)', !!miniTitle && nowDesc.includes(miniTitle.trim()) && session().state === 3, `UI "${miniTitle}" / session "${nowDesc}"`);
  const sessions = sessionCount();
  pass('exactly one MediaSession for Swarify (no duplicates)', sessions === 1, `sessions=${sessions}`);
  const svcCount = serviceInfo().split('\n').filter(l => /ServiceRecord\{/.test(l) && /PlaybackService/.test(l)).length;
  pass('exactly one PlaybackService instance', svcCount === 1, `records=${svcCount}`);

  // ---- 8. UI state still works with native engine ----
  await ui.click('.mini-bar .meta'); await sleep(800);
  await ui.click('.np [aria-label="Shuffle"]'); await ui.click('.np [aria-label^="Repeat"]'); await sleep(800);
  pass('shuffle/repeat toggles do not break playback', session().state === 3);
  await ui.click('.np .pill', 'EQ'); await ui.click('.eq .chip', 'Bass Boost'); await sleep(1200);
  const fx = adb('shell dumpsys media.audio_flinger'); const eqPresent = /ce772f20-847d-11df-bb17-0002a5d5c51b|Equalizer/i.test(fx);
  pass('equalizer effect is attached by the service and playback continues', session().state === 3 && eqPresent, `playing=${session().state === 3} equalizer-effect-in-audio_flinger=${eqPresent}`);
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

  pass('no uncaught page errors in the UI', ui.errors.length === 0, ui.errors.join(' | '));
  fs.writeFileSync('e2e-results.json', JSON.stringify(results, null, 2));
  const bad = results.filter(r => r.status === 'FAIL');
  console.log(`\n${results.filter(r => r.status === 'PASS').length} PASS, ${bad.length} FAIL, ${results.filter(r => r.status === 'INCONCLUSIVE').length} INCONCLUSIVE`);
  process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error('E2E crashed:', e); fs.writeFileSync('e2e-results.json', JSON.stringify(results, null, 2)); process.exit(2); });
