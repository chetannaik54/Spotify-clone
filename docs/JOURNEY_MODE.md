# Journey Mode — status and evidence

| # | Milestone | State |
|---|---|---|
| 1 | Journey Mode UI + preparation dashboard | **Built** |
| 2 | Offline inventory + storage estimator (+ cached lyrics, scan size/genre/year) | **Built** |
| 3 | Smart preparation engine (v1 selection only) | Not started |
| 4 | Guess the Song / Trivia / Sing Along | Not started |
| 5 | Mood DJ | Not started |
| 6 | Sleep Journey | Not started |
| 7 | Audio Cinema + Journey Memories | Not started |
| 8 | Full offline verification (files, integrity, playback) → READY | Not started |

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
