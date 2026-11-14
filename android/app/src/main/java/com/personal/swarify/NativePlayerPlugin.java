package com.personal.swarify;

import android.Manifest;
import android.content.ComponentName;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;

import androidx.core.content.ContextCompat;
import androidx.media3.common.MediaItem;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.session.MediaController;
import androidx.media3.session.SessionToken;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import com.google.common.util.concurrent.ListenableFuture;

import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/** JS <-> PlaybackService bridge. Holds a MediaController; never owns a player itself. */
@UnstableApi
@CapacitorPlugin(
    name = "NativePlayer",
    permissions = { @Permission(strings = { Manifest.permission.POST_NOTIFICATIONS }, alias = "notifications") }
)
public class NativePlayerPlugin extends Plugin {
    private final Handler main = new Handler(Looper.getMainLooper());
    private ListenableFuture<MediaController> future;
    private MediaController controller;
    private final List<Runnable> waiting = new ArrayList<>();
    private boolean resumed = true;

    private interface Use { void run(MediaController c) throws Exception; }

    /** Run on the main thread once the controller is connected. */
    private void use(PluginCall call, Use u) {
        main.post(() -> whenConnected(() -> {
            try { u.run(controller); if (call != null && !call.isReleased()) call.resolve(); }
            catch (Exception e) { if (call != null) call.reject(String.valueOf(e.getMessage())); }
        }, call));
    }

    private void whenConnected(Runnable r, PluginCall call) {
        if (controller != null && controller.isConnected()) { r.run(); return; }
        waiting.add(r);
        if (future != null) return;
        try {
            SessionToken token = new SessionToken(getContext(), new ComponentName(getContext(), PlaybackService.class));
            future = new MediaController.Builder(getContext(), token).buildAsync();
            future.addListener(() -> {
                try {
                    controller = future.get();
                    controller.addListener(new PlayerEvents());
                    List<Runnable> run = new ArrayList<>(waiting); waiting.clear();
                    for (Runnable w : run) w.run();
                } catch (Exception e) {
                    future = null; waiting.clear();
                    if (call != null) call.reject("Could not connect to playback service: " + e.getMessage());
                }
            }, ContextCompat.getMainExecutor(getContext()));
        } catch (Exception e) { future = null; waiting.clear(); if (call != null) call.reject(e.getMessage()); }
    }

    // ---------- commands ----------
    @PluginMethod
    public void setQueue(PluginCall call) {
        final JSArray arr = call.getArray("tracks");
        final int index = call.getInt("index", 0);
        final long posMs = Math.round(call.getDouble("position", 0.0) * 1000);
        final boolean play = call.getBoolean("play", false);
        final boolean keep = call.getBoolean("keepCurrent", false);
        use(call, c -> {
            List<MediaItem> items = new ArrayList<>();
            for (int i = 0; i < arr.length(); i++) items.add(PlayerPrefs.item(arr.getJSONObject(i)));
            if (items.isEmpty()) { c.clearMediaItems(); return; }
            int idx = Math.max(0, Math.min(index, items.size() - 1));
            MediaItem cur = c.getCurrentMediaItem();
            if (keep && cur != null && cur.mediaId.equals(items.get(idx).mediaId)) {
                // Edit around the playing item so playback is not interrupted.
                int ci = c.getCurrentMediaItemIndex(), n = c.getMediaItemCount();
                if (ci + 1 < n) c.removeMediaItems(ci + 1, n);
                if (ci > 0) c.removeMediaItems(0, ci);
                if (idx > 0) c.addMediaItems(0, items.subList(0, idx));
                if (idx + 1 < items.size()) c.addMediaItems(items.subList(idx + 1, items.size()));
            } else {
                c.setMediaItems(items, idx, posMs);
                c.prepare();
            }
            if (play) c.play();
        });
    }
    @PluginMethod public void play(PluginCall call) { use(call, c -> { if (c.getPlaybackState() == Player.STATE_IDLE) c.prepare(); c.play(); }); }
    @PluginMethod public void pause(PluginCall call) { use(call, MediaController::pause); }
    @PluginMethod public void next(PluginCall call) { use(call, c -> { if (c.hasNextMediaItem()) c.seekToNextMediaItem(); else c.seekTo(0, 0); c.play(); }); }
    @PluginMethod public void previous(PluginCall call) { use(call, c -> { c.seekToPrevious(); c.play(); }); }
    @PluginMethod public void skipTo(PluginCall call) { final int i = call.getInt("index", 0); use(call, c -> { if (i >= 0 && i < c.getMediaItemCount()) c.seekTo(i, 0); }); }
    @PluginMethod public void seekTo(PluginCall call) { final long ms = Math.round(call.getDouble("position", 0.0) * 1000); use(call, c -> c.seekTo(ms)); }
    @PluginMethod public void setShuffle(PluginCall call) { final boolean e = call.getBoolean("enabled", false); use(call, c -> c.setShuffleModeEnabled(e)); }
    @PluginMethod public void setRepeat(PluginCall call) {
        final String m = call.getString("mode", "off");
        use(call, c -> c.setRepeatMode("one".equals(m) ? Player.REPEAT_MODE_ONE : "all".equals(m) ? Player.REPEAT_MODE_ALL : Player.REPEAT_MODE_OFF));
    }

    // settings are stored natively so the service can restore them with no UI running
    @PluginMethod public void setVolume(PluginCall call) {
        PlayerPrefs.sp(getContext()).edit().putFloat("volume", (float) (double) call.getDouble("volume", 1.0)).apply();
        poke(call);
    }
    @PluginMethod public void setCrossfade(PluginCall call) {
        PlayerPrefs.sp(getContext()).edit().putInt("crossfade", call.getInt("seconds", 0)).apply();
        poke(call);
    }
    @PluginMethod public void setEq(PluginCall call) {
        try {
            JSArray a = call.getArray("gains"); float[] g = new float[5];
            for (int i = 0; i < 5 && i < a.length(); i++) g[i] = (float) a.getDouble(i);
            PlayerPrefs.setEq(getContext(), g);
        } catch (Exception e) { call.reject(e.getMessage()); return; }
        poke(call);
    }
    @PluginMethod public void setSleep(PluginCall call) {
        final long at = call.getData().optLong("at", 0);
        main.post(() -> { PlaybackService s = PlaybackService.instance; if (s != null) s.setSleepAt(at); call.resolve(); });
    }
    private void poke(PluginCall call) {
        main.post(() -> { PlaybackService s = PlaybackService.instance; if (s != null) s.applySettings(); call.resolve(); });
    }

    @PluginMethod
    public void getState(PluginCall call) {
        final boolean full = call.getBoolean("full", false);
        main.post(() -> {
            if (PlaybackService.instance == null) { // nothing running: do not start a service just to look
                JSObject o = new JSObject(); o.put("count", 0); o.put("index", 0); o.put("playing", false); o.put("ids", new JSArray());
                call.resolve(o); return;
            }
            whenConnected(() -> call.resolve(snapshot(full)), call);
        });
    }

    private JSObject snapshot(boolean full) {
        MediaController c = controller;
        JSObject o = new JSObject();
        int st = c.getPlaybackState();
        o.put("count", c.getMediaItemCount());
        o.put("index", Math.max(0, c.getCurrentMediaItemIndex()));
        o.put("playing", c.getPlayWhenReady() && st != Player.STATE_ENDED && st != Player.STATE_IDLE);
        o.put("state", st == Player.STATE_BUFFERING ? "buffering" : st == Player.STATE_READY ? "ready" : st == Player.STATE_ENDED ? "ended" : "idle");
        o.put("shuffle", c.getShuffleModeEnabled());
        o.put("repeat", c.getRepeatMode() == Player.REPEAT_MODE_ONE ? "one" : c.getRepeatMode() == Player.REPEAT_MODE_ALL ? "all" : "off");
        o.put("position", c.getCurrentPosition() / 1000.0);
        long d = c.getDuration(); o.put("duration", d > 0 ? d / 1000.0 : 0);
        MediaItem cur = c.getCurrentMediaItem(); o.put("currentId", cur == null ? "" : cur.mediaId);
        JSArray ids = new JSArray(); JSArray tracks = new JSArray();
        for (int i = 0; i < c.getMediaItemCount(); i++) {
            MediaItem m = c.getMediaItemAt(i); ids.put(m.mediaId);
            if (full) {
                JSObject t = new JSObject();
                t.put("id", m.mediaId); t.put("title", String.valueOf(m.mediaMetadata.title)); t.put("artist", String.valueOf(m.mediaMetadata.artist));
                t.put("album", m.mediaMetadata.albumTitle == null ? "" : String.valueOf(m.mediaMetadata.albumTitle));
                t.put("art", m.mediaMetadata.artworkUri == null ? "" : m.mediaMetadata.artworkUri.toString());
                t.put("url", m.localConfiguration == null ? "" : m.localConfiguration.uri.toString());
                tracks.put(t);
            }
        }
        o.put("ids", ids); if (full) o.put("tracks", tracks);
        return o;
    }

    @PluginMethod
    public void requestNotifications(PluginCall call) {
        if (Build.VERSION.SDK_INT < 33 || getPermissionState("notifications") == PermissionState.GRANTED) {
            JSObject o = new JSObject(); o.put("granted", true); call.resolve(o); return;
        }
        requestPermissionForAlias("notifications", call, "onNotifPermission");
    }
    @PermissionCallback
    private void onNotifPermission(PluginCall call) {
        JSObject o = new JSObject(); o.put("granted", getPermissionState("notifications") == PermissionState.GRANTED); call.resolve(o);
    }

    // ---------- events to JS ----------
    private final class PlayerEvents implements Player.Listener {
        private void emit() { notifyListeners("state", snapshot(false)); }
        @Override public void onMediaItemTransition(MediaItem m, int r) { emit(); }
        @Override public void onPlayWhenReadyChanged(boolean p, int r) { emit(); }
        @Override public void onPlaybackStateChanged(int s) { emit(); }
        @Override public void onShuffleModeEnabledChanged(boolean e) { emit(); }
        @Override public void onRepeatModeChanged(int m) { emit(); }
        @Override public void onTimelineChanged(androidx.media3.common.Timeline t, int r) { emit(); }
        @Override public void onPlayerError(PlaybackException e) { JSObject o = new JSObject(); o.put("message", e.getMessage()); notifyListeners("error", o); }
    }

    private final Runnable ticker = new Runnable() {
        @Override public void run() {
            if (controller != null && controller.isConnected() && controller.isPlaying() && hasListeners("time")) {
                JSObject o = new JSObject();
                o.put("position", controller.getCurrentPosition() / 1000.0);
                long d = controller.getDuration(); o.put("duration", d > 0 ? d / 1000.0 : 0);
                notifyListeners("time", o);
            }
            if (resumed) main.postDelayed(this, 500);
        }
    };

    @Override protected void handleOnResume() { resumed = true; main.removeCallbacks(ticker); main.post(ticker); if (controller != null && controller.isConnected()) notifyListeners("state", snapshot(false)); }
    @Override protected void handleOnPause() { resumed = false; main.removeCallbacks(ticker); }
    @Override protected void handleOnDestroy() { main.removeCallbacksAndMessages(null); if (future != null) MediaController.releaseFuture(future); future = null; controller = null; }
}
