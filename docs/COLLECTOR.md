# Playlist Collector

Import metadata (never audio) from Spotify and YouTube → match to downloadable, licensed recordings → download → offline playlists.

## Status
| Milestone | Scope | State |
|---|---|---|
| 1 | Audit, Collector UI, Spotify OAuth (PKCE), playlist + liked-song import, unified catalogue | **Implemented** (see test evidence below) |
| 2 | YouTube OAuth + import | Not started (card shown disabled) |
| 3 | Matching engine + download-permission checks | Not started |
| 4 | Android download manager + automatic Swarify playlists | Not started |
| 5 | Incremental sync, security review, full regression | Not started (selected-playlist sync and removed-entry tracking already in place) |

## One-time Spotify setup
1. https://developer.spotify.com/dashboard → create an app.
2. Add the Redirect URI shown in Swarify (Collector → Spotify → Setup): `com.personal.swarify://auth/spotify`.
3. Paste the app's **Client ID** into Swarify. No client secret is used or stored (PKCE).
4. Spotify development-mode apps only work for users you allow-list in the dashboard.

## Design
- `src/lib/collector/spotify/auth.ts` – Authorization Code + PKCE (S256), state check, single-use verifier, refresh with shared in-flight refresh, `ReauthRequired` on revoked grants.
- `src/lib/collector/spotify/client.ts` – pagination via `next`, 401→refresh once, 429 `Retry-After`, 5xx backoff, `/tracks`→`/items` fallback, null/local/episode items kept as `unavailable` so order is preserved.
- `src/lib/collector/catalogue.ts` – unified catalogue in the app's existing IndexedDB (`c_tracks`, `c_playlists`, `c_syncs`, `c_accounts`): one row per `(platform, source id)`; playlists hold ordered entry lists; re-imports never reset matching/download state; entries removed at the source are flagged, never deleted.
- `SecureStorePlugin.java` – Android Keystore (AES-256-GCM) `EncryptedSharedPreferences` for tokens. Browser fallback is sessionStorage (dev only).
- Deep link `com.personal.swarify://auth/spotify` handled through `@capacitor/app`; sign-in opens in the system browser (`@capacitor/browser`).
- Consent dialog before connecting; permissions are read-only: `playlist-read-private playlist-read-collaborative user-library-read`.

## Privacy
Imported data stays on the device. Spotify audio is never fetched. In the later matching step only song titles/artists/durations (no account or playlist names) will be sent to catalogue APIs, after a second consent prompt.
Disconnect removes tokens locally; Spotify has no revocation endpoint, so access can also be removed at spotify.com/account/apps. Disconnect offers *keep* or *remove imported data* (tracks with a downloaded local file are never removed).

## Run the tests
`npm test` (27 unit tests against a fake Spotify server). Browser E2E and device checks are described in the milestone report.

## Evidence log
| Date | Where | Result |
|---|---|---|
| 14 Nov | **Physical tablet** (user screenshot) | Collector tab renders; Spotify sign-in → redirect → token exchange → encrypted storage worked (card shows *Connected*). First data call returned **HTTP 403**: the Spotify app was created without *Web API* (greyed out: requires Premium owner), so tokens are issued but API calls are refused. Not an app defect; error text now explains it. |
| 14 Nov | Fake Spotify server (unit + browser) | 47 unit tests, 54 browser checks pass. **Simulated.** |
