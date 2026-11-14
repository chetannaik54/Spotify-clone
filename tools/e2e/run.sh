#!/usr/bin/env bash
# Runs inside the Android emulator (reactivecircus/android-emulator-runner). Emulated, not a physical device.
set -x
cd "$(dirname "$0")"
mkdir -p /tmp/e2e-audio
python3 - <<'PY'
import wave, struct, math
for name, f in [('Tum Hi Ho', 440), ('Kesariya', 523), ('Channa Mereya', 659)]:
    w = wave.open(f'/tmp/e2e-audio/{name}.wav', 'wb'); w.setnchannels(1); w.setsampwidth(2); w.setframerate(8000)
    w.writeframes(b''.join(struct.pack('<h', int(3000 * math.sin(2 * math.pi * f * i / 8000))) for i in range(8000 * 600)))
    w.close()
PY
adb install -r -g ../../android/app/build/outputs/apk/debug/app-debug.apk
npm install --no-audit --no-fund
node e2e.js 2>&1 | tee e2e.log
exit "${PIPESTATUS[0]}"
