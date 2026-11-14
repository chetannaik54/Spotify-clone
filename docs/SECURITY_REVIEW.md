# Security & privacy review (Collector / Journey)

Method: code search + manifest inspection + dependency audit + tests. Date: 14–15 Nov 2026.

| # | Area | Finding | Evidence | Status |
|---|---|---|---|---|
| 1 | Passwords | Never requested or stored. Spotify: OAuth Authorization Code + PKCE. Google: device flow (user signs in at google.com/device). | `spotify/auth.ts`, `google/auth.ts`; unit test asserts no `password`/`client_secret` in the Spotify token request | ✅ |
| 2 | Token storage | Android: Keystore-backed `EncryptedSharedPreferences` (AES-256-GCM/SIV). Never in localStorage. Browser fallback = `sessionStorage` (dev only). | `SecureStorePlugin.java`; grep: no token/secret in `localStorage` | ✅ code · ⚠ not yet run on a device with a real token |
| 3 | API secrets in source | None. Spotify uses no secret (PKCE). The Google OAuth client ID/secret are the user's own and entered at runtime into encrypted storage. | grep for `GOCSPX`, `AIza…`, `sk_live`, key literals: only UI placeholders/variable names | ✅ |
| 4 | Scopes | Read-only: Spotify `playlist-read-private playlist-read-collaborative user-library-read`; Google `youtube.readonly`. | unit test checks no write/modify scopes | ✅ |
| 5 | OAuth hardening | PKCE S256; random `state` verified; verifier single-use; 10-min expiry; replay rejected. | `tests/spotify-auth.test.ts` | ✅ |
| 6 | Revocation / disconnect | Google: token revoked at Google, then cleared. Spotify offers no revoke endpoint → tokens cleared locally and the user is told to remove access at spotify.com/account/apps. Disconnect offers keep/remove imported data. | tests + UI | ✅ |
| 7 | Consent & data sharing | Consent screens before connecting and before any online matching. Only song **title + artist** are sent to catalogues (test asserts playlist/account/file names never appear in requests). | `tests/matching.test.ts`, browser test | ✅ |
| 8 | Downloads | Only recordings whose source explicitly permits it; user review required; nothing automatic (auto-download is an off-by-default setting limited to exact verified matches). Integrity: size and header checked, bad files deleted. | `download.test.ts`, emulator e2e | ✅ |
| 9 | Network policy | Release builds are HTTPS-only. Cleartext to `10.0.2.2/localhost` exists **only in the debug build** for the emulator test. | `src/debug/…network_security_config_debug.xml` | ✅ |
| 10 | Android backup | **Issue found:** `allowBackup="true"` could copy app data off-device and restore encrypted tokens where the Keystore key does not exist. **Fixed:** `allowBackup="false"`. | manifest | ✅ fixed |
| 11 | Exported components | `MainActivity` (launcher + `com.personal.swarify://auth` deep link), `PlaybackService` and `MediaButtonReceiver` are exported because Android media controls require it. The deep link is protected by the OAuth `state` check. | manifest | ✅ accepted |
| 12 | Permissions | INTERNET, READ_MEDIA_AUDIO (scan), POST_NOTIFICATIONS, FOREGROUND_SERVICE(+media/dataSync), WAKE_LOCK, RECORD_AUDIO (voice memories, asked at use), MODIFY_AUDIO_SETTINGS. No contacts/location/camera/SMS. | manifest | ✅ |
| 13 | Dependencies | `npm audit --omit=dev`: 0 vulnerabilities. | run | ✅ |
| 14 | Logging | No `console.log/info/debug`; no token/secret in warn/error calls. | grep | ✅ |
| 15 | Private memories | Photos/voice notes/text stay on the device (IndexedDB); nothing is uploaded. Voice-note preview uses a standard audio element, separate from the music engine. | code | ✅ |
| 16 | Third-party terms | Spotify/YouTube: metadata only, no audio fetched, cached or redistributed. Spotify dev-mode apps are limited to allow-listed users and (as seen) need a Premium owner for Web API. | docs | ✅ / user action |

## Not yet verified
- Token storage and the OAuth round-trips against the **real** Spotify/Google services (only Spotify sign-in was seen working on the tablet; the data call was refused by the missing Web API access).
- The Android downloader on a physical tablet (emulator test only).
- Release-build behaviour (everything above was tested on debug builds).
