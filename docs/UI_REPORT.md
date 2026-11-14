# Swarify UI/UX pass – implementation report

## Folder / device scan (the import complaint)
- New native Android plugin `MediaScanPlugin.java` (MediaStore) – **one tap scans every music file on the device, all folders and SD card**; asks for the audio permission itself.
- Library → My Music: folder chips (filter by directory), search covers local songs, "Import folder" (whole directory) and "Pick files" as fallbacks.
- Local songs are stored in the existing `local` state; playback goes through the existing engine (content:// served by Capacitor's local server).

## UI changes
| Area | Change |
|---|---|
| Cards | Fixed width via `--card-w`, 1:1 artwork, 2-line title clamp + 1-line artist, scroll-snap carousels, desktop arrows, branded placeholder art |
| Home | Greeting + quick tiles, Continue Listening (resumes at saved position), Recently Played, Your Playlists, Trending Music, Recommended Albums (opens album page), artist shelves |
| Navigation | Sidebar ≥1024px, icon rail 600–1023px, bottom tab bar <600px; gold active indicator; SVG icons |
| Mini-player | In layout flow (cannot overlap content or tab bar), progress line, safe-area aware |
| Now Playing | Seek bar + timestamps, shuffle/prev/play/next/repeat, volume, sleep, queue/lyrics/EQ panel with tabs and close; landscape = art + controls + panel, portrait = panel replaces art |
| Safe areas | `viewport-fit=cover`, `env(safe-area-inset-*)`, Android status/navigation bar colour set to the app background |

## Verification (Chromium, built app)
Viewports: tablet landscape 1280×800, tablet portrait 800×1280, mobile 390×844.
Automated checks per screen (home, library, search, album, now playing with each panel): page overflow, mini-player vs content/tab bar overlap, text clipping, card size consistency, now-playing elements inside viewport, console errors – **all clean**. Playback: play, pause, next, shuffle, repeat, time advancing, playback continuing across tab navigation – pass.

Two real bugs were found by this testing and fixed: panel hid player controls (landscape) and a bottom sheet covered controls (portrait/phone).

## Not verified here
- The Android build and the native scan plugin (no Android SDK in this environment) – CI compiles them; test the scan on the tablet.
- Online catalogue calls were stubbed in the test harness (hosts blocked here); no mocks exist in the app.
