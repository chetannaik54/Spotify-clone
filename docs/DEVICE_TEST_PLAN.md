# Swarify – physical tablet test plan (background playback milestone)

Only a real device can confirm these. Install the APK from the latest GitHub Actions run (`swarify-debug-apk`).
Tick each box and note the tablet model + Android version. Use a **local song from "Scan device"** for tests 2–9
and one **online preview/stream** for test 10.

| # | Test | Steps | Expected | Result |
|---|---|---|---|---|
| 1 | Permissions + scan | Library → My Music → *Scan device for music*; allow "Music and audio"; allow notifications on first play | Songs from every folder (Music, Download, SD card) appear; folder chips list each directory | ☐ |
| 2 | Playback + notification | Play a scanned song | Notification with art, title, ⏮ ⏯ ⏭; sound plays | ☐ |
| 3 | Background | Press Home, open another app | Music continues, notification stays | ☐ |
| 4 | Screen lock – 30 min | Lock screen, leave 30 min (plug in/unplug as you normally use it) | Still playing; queue advanced; no stutter at track changes | ☐ |
| 5 | Lock-screen controls | Wake screen (don't unlock) | Controls visible; Pause / Play / Next / Previous work | ☐ |
| 6 | Swipe from recents | Recents → swipe Swarify away | Music keeps playing; notification remains; controls work | ☐ |
| 7 | Reopen after swipe | Tap Swarify | UI shows the same song/position/queue; no second stream, no echo | ☐ |
| 8 | Bluetooth headset | Pair headset: play/pause, next, previous buttons; also car kit if available | Each button acts on Swarify; track info shown on headset/car | ☐ |
| 9 | Phone call | Call the tablet / use WhatsApp call | Music pauses on ring/answer; resumes after the call ends | ☐ |
| 10 | Headphone unplug | Wired/BT headphones: disconnect while playing | Pauses immediately (no blast through speaker) | ☐ |
| 11 | Other audio app | Play YouTube/other music app | Swarify pauses (or ducks for short sounds) and does not fight for audio | ☐ |
| 12 | Restart recovery | Play a song, pause, reboot tablet, press ▶ on a Bluetooth headset / lock-screen control (do **not** open the app) | Swarify restores last queue and plays from the saved spot | ☐ |
| 13 | Equalizer | Now Playing → EQ → Bass Boost | Audible change, no interruption; persists after restart | ☐ |
| 14 | Sleep timer | Sleep → 15 min, swipe app away | Music stops at 15 min even with the app closed | ☐ |
| 15 | Shuffle / repeat | Toggle both, let several songs finish with screen locked | Order/looping respected in the background | ☐ |
| 16 | Lyrics | Play a song with online lyrics | Lyrics scroll in time | ☐ |
| 17 | Battery | Note battery % before/after test 4 | Report the drop | ☐ |

If a step fails, note: tablet model, Android version, battery-saver / "app battery optimisation" setting for Swarify,
and the exact moment it failed. On Samsung/Xiaomi/OPPO tablets set Swarify's battery usage to **Unrestricted**.
