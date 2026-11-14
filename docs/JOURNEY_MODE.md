# Journey Mode — status and evidence

| # | Milestone | State |
|---|---|---|
| 1 | Journey Mode UI + preparation dashboard | **Built** |
| 2 | Offline inventory + storage estimator (+ cached lyrics, scan size/genre/year) | **Built** |
| 3 | Smart preparation (selection by genre/duration/storage, deterministic) | **Built** (v1) |
| 4 | Guess the Song (song/singer/movie/year/lyrics) + Trivia + Sing Along | **Built** |
| 5 | Mood DJ (7 moods, tag-based, learns from ✓/✕) | **Built** |
| 6 | Sleep Journey (library sounds, timer, 30 s native fade) | **Built** — no sleep audio ships with the app |
| 7 | Audio Cinema (stories/podcasts library) + Journey Memories | **Built** (library from files on the device) |
| 8 | Offline verification → READY | **Built** (native file/decoder checks + freshness); device run pending |

## What exists
- **Journey tab**: plan wizard (type, 2/5/8/12 h, storage limit, genres, experiences), cinematic hero, readiness ring, checklist, storage meter, experience grid.
- **Inventory** (`src/lib/journey/inventory.ts`): counts only audio stored on the device (scanned local files). Online previews/streams and imported-but-not-downloaded Spotify/YouTube songs never count as offline.
- **Selection v1**: deterministic mix by genre until duration or storage limit; skips oversize tracks so smaller ones can still fit.
- **Readiness**: `READY` requires every mandatory check, including a *playback verification* that does not exist yet — so the app currently can never say READY. That is deliberate.
- **Lyrics cache** (IndexedDB `lyrics`): "Cache lyrics" fetches once; afterwards lyrics display with no network. "No lyrics" answers are remembered for 7 days.
- Native scan now also reads **file size, genre (Android 11+) and year**.

## Not available yet (shown honestly in the UI)
Mood DJ, Audio Stories, Podcasts, Trivia, Guess the Song, Sing Along, Sleep Journey, Journey Memories — their tiles are disabled and labelled with the step that delivers them. Stories/podcasts/sleep audio also need a licensed audio library (nothing is bundled or fabricated).

## Offline claims — what has actually been tested
| Claim | Evidence | Level |
|---|---|---|
| Cached lyrics display with the network switched off; no lyric request is made | Browser test with network disabled (Playwright `setOffline`) | **Simulated** |
| Journey screen, checklist and inventory work with the network off | Same | **Simulated** |
| Journey mix plays offline on the tablet | — | **NOT tested** (needs a physical device in airplane mode) |
| Scanned files remain playable offline | — | **NOT tested** |


## Update: what each experience really does (and does not)
- **Offline verification**: Android checks every mix file (exists, readable, audio header, decodable by the media demuxer, length matches). Plus lyrics (if sing-along on), no network references, free space. Result is tied to the exact mix — changing the plan/files withdraws READY. Browser tests use browser-stored files (simulated); device files can only be verified in the Android app.
- **Guess the Song / Trivia**: only your own on-device songs (never previews). Six modes × easy/medium/hard, per-question timer, score with speed/difficulty/streak, local top-10 leaderboard. Clips play through the normal player; your queue is restored afterwards.
- **Mood DJ**: scores titles/albums/genres/years with English + Hinglish keywords and your ✓/✕ feedback. It is **not audio analysis** and says so.
- **Stories / Podcasts / Sleep**: organise audio files you already have (auto-suggested from names/folders); remembers playback position; sleep journeys repeat with crossfade and fade out natively over the last 30 s. **No story/sleep audio is bundled** and online discovery of licensed audio is not built.
- **Memories**: text, photos (compressed), private voice notes, favourite song, journey playlist — stored on the device only.

### Evidence
| Check | Level |
|---|---|
| 183 unit tests incl. quiz/mood/library/memories/verification logic | Simulated |
| Browser tests: Journey 72, features 54, READY flow 9 (browser-stored files) | Simulated |
| Native verify() on a device; offline playback with the network disconnected | **NOT tested** — see `DEVICE_TEST_PLAN.md` |
