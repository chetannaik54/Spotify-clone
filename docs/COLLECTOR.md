# Playlist Collector

Import metadata (never audio) from Spotify and YouTube → match to downloadable, licensed recordings → download → offline playlists.

## Status
| Milestone | Scope | State |
|---|---|---|
| 1 | Audit, Collector UI, Spotify OAuth (PKCE), playlist + liked-song import, unified catalogue | **Implemented** (see test evidence below) |
| 2 | YouTube OAuth + import (+ CSV import) | **Implemented** (tested against a fake Google; real-account run pending) |
| 3 | Matching engine + download-permission checks | **Implemented** (simulated catalogues; real-catalogue run pending) |
| 4 | Android download manager + automatic Swarify playlists | **Implemented** — JS manager fully tested; Android plugin compiles in CI; emulator test below |
| 5 | Incremental sync, security review, full regression | **Implemented** — see `SECURITY_REVIEW.md` |

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

## Milestone 2 — YouTube + CSV (this update)
- **Sign-in**: Google OAuth *device flow* (user types a code at google.com/device). Read-only scope `youtube.readonly`. Client ID/secret belong to the user's own Google Cloud project, entered at runtime, kept in encrypted storage — never in source. Calls go through Capacitor's native HTTP so WebView CORS cannot block Google endpoints.
- **Import**: playlists, playlist items (original order), liked videos (`myRating=like`). Private/deleted videos stay in place as *Unavailable*. Each video is scored (category, “Topic”/label channels, title words, duration) — non-songs are kept but flagged *Not a song*, with a one-tap override that survives re-imports.
- **CSV import**: Exportify-style files; Spotify track URIs keep their ID so they dedupe with API imports.
- **Disconnect** revokes the grant at Google (best effort) and clears tokens.
- **Known limits**: Watch Later / history are not exposed by the API; consent screens left in “Testing” expire access every 7 days; daily API quota applies (10,000 units — a normal import uses a few hundred).

### Evidence (Milestone 2)
| Check | Level |
|---|---|
| 76 unit tests (device flow incl. slow_down/denied/expired/cancel, refresh, revoke, pagination, private/deleted, classification, title parsing, CSV, dedupe) | **Simulated** (fake Google server) |
| 54 browser checks of the real screen at 3 sizes | **Simulated** |
| Real Google sign-in / real YouTube data on the tablet | **NOT tested** |

## Milestone 3 — Matching (this update)
Imported songs are matched to recordings you can legitimately keep. **Downloading itself is Milestone 4**; the Download buttons are present but disabled.

**Sources**: your own device (no network), Internet Archive, Jamendo, SoundCloud. Online sources run only after a second consent prompt and only send each song's *title and artist*.

**Confidence** (title 45 % · artist 30 % · duration 15 % · album 10 %): ≥95 exact · 80–94 likely (confirm) · <80 manual review. Hard rules: a different version (remix/live/cover/instrumental/karaoke/acoustic/slowed/mashup), a different artist, a >20 s duration gap or a preview-only file can never reach “likely”; an unknown original artist can never reach “exact”. Only an unflagged exact match is auto-selected; everything else waits for you.

**Download permission is verified per recording from the source's own data** — a reachable stream is never treated as permission:
| Source | Permitted only when |
|---|---|
| Jamendo | `audiodownload_allowed = true` **and** a download URL; license recorded |
| Internet Archive | explicit Creative Commons / public-domain license in item metadata, not access-restricted/dark, has an audio file |
| SoundCloud | `downloadable` (artist-enabled) **and** `access = playable` **and** downloads remaining |
| This device | file already stored locally (status *downloaded*, `local_file_id` set) |

**Honest statuses**: no candidates and every source searched → *No match*; any source failed → *Failed* (retry), never a false “no match”. “Free downloads available” counts only acceptable matches, not covers/remixes that happen to be downloadable.

### Evidence (Milestone 3)
| Check | Level |
|---|---|
| 118 unit tests (scoring bands incl. cover/remix/live/instrumental/karaoke/different artist, per-source permission matrix, privacy of queries, pipeline: bulk, partial outage, retry, skip, confirm/reject, local registration) | **Simulated** (fake Jamendo / Archive / SoundCloud following their documented shapes) |
| 66 browser checks of the real Matching screen at 3 sizes | **Simulated** |
| Real Jamendo / Internet Archive / SoundCloud responses | **NOT tested** (hosts unreachable from the build environment; SoundCloud API access for new apps is restricted) |
| Matching on the physical tablet | **NOT tested** |

### Matching follow-up (CSV playlist test on the tablet)
- **Verified on the physical tablet (user screenshot):** a 50-song CSV (90s/2000s Bollywood) imports correctly, in order.
- Matching runs in original playlist order, with a playlist picker; summary tiles (Exact / Possible / Unavailable / Downloadable / On device); one clear action **Find Available Downloads**; **Download eligible (N)** is shown but disabled — nothing downloads before review and the downloader (Milestone 4) exists.
- Playlist names: file-name noise removed (`swarify_bollywood_90s_2000s_test_fixed.csv` → “Swarify Bollywood 90s 2000s”), one small source pill instead of repeated “CSV file · CSV file”, and a ✎ rename that survives re-imports.
- **Copy results** puts the real outcome (ordered CSV with confidence, source, permission and reason per song) on the clipboard so it can be shared and analysed.
- **Expectation:** commercial 90s Bollywood is rarely freely licensed. Expect mostly *Unavailable* from Jamendo / Internet Archive / SoundCloud; matches against files already on the device are the most likely hits.
- Real-catalogue results for this playlist: **not yet obtained** (needs a run on the tablet with a Jamendo client ID).


## Milestone 4–5 (this update)
- **Download manager** (`collector/download/`): queue (2 at a time), pause/resume (keeps partial data), cancel (discards), retry with backoff (network/5xx only — 403/404/integrity are not retried), Wi-Fi-only, storage allowance + free-space check, duplicate detection (already downloaded / already in library / already queued), integrity (size + audio header), recovery after restart. Only a **confirmed match with verified download permission** can be queued, and only from the *Review downloads* sheet (nothing pre-selected). *Auto-download exact matches* exists but is **off by default**.
- **Android storage**: `DownloaderPlugin` writes through MediaStore (scoped storage, no storage permission) to `Music/Swarify/<Artist>/<Album>/<Title>.<ext>` as a pending item, resumes with HTTP `Range`, validates the header, and runs under a `dataSync` foreground service. Android 10+ only.
- **Library registration**: finished files are added to the local library (id `lo-ms-<MediaStore id>`, same as a device scan, so a later scan never duplicates them), the song is marked *downloaded* and linked via `local_file_id`.
- **Automatic Swarify playlists**: every imported playlist is mirrored into the Library with its clean name, artwork, source tag and original order; downloaded songs play, the rest are greyed placeholders with the reason and are never queued. User-made playlists are never touched.
- **Sync**: manual, per-playlist selection, optional Daily/Weekly (runs while Swarify is open), counts new / updated / removed-at-source; local files and downloads are never deleted.

### Evidence (M4–M5)
| Check | Level |
|---|---|
| 183 unit tests (manager: eligibility, lifecycle, retries, Wi-Fi, storage; mirror; sync) | Simulated |
| Browser end-to-end vs a **real local HTTP server** with Range support: pause → resume sends `Range: bytes=…`; bad file rejected; library + playlist registration | Real HTTP, browser storage (not Android) |
| Android plugin: compiled in CI; emulator test (MediaStore path, SHA-256, Range resume, integrity, cancel, native playback of the file) | Emulator — see report |
| Downloads on the physical tablet | **NOT tested** |
