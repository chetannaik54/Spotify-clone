# Swarify – personal Spotify-style Bollywood player (Android tablet)

React + Vite + Capacitor. Features: animated album-art-tinted living background, full-screen player,
synced lyrics (LRCLIB), 5-band equalizer, crossfade, sleep timer, shuffle/repeat, queue/play-next,
liked songs, playlists, recently played, local file import (IndexedDB), lock-screen controls.

## Get the APK
Push to GitHub → Actions → **Build Android APK** → download `swarify-debug-apk` → install on tablet.
Or locally (Android Studio + JDK 17): `npm i && npm run android:sync && npm run android:open`.

## Music sources
| Source | Content | Key |
|---|---|---|
| Apple iTunes Search | Bollywood metadata + 30s previews | none |
| Jamendo | full tracks (licensed free) | free client_id → Settings |
| Internet Archive | full tracks (public domain / uploader-licensed) | none |
| Local files | your own full songs | none |

Add a source by returning `Track[]` in `src/lib/sources.ts`.
