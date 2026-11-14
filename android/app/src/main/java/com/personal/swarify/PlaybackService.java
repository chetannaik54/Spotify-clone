package com.personal.swarify;

import android.app.PendingIntent;
import android.content.Intent;
import android.media.audiofx.Equalizer;
import android.os.Handler;
import android.os.Looper;

import androidx.annotation.Nullable;
import androidx.media3.common.AudioAttributes;
import androidx.media3.common.C;
import androidx.media3.common.MediaItem;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.session.MediaSession;
import androidx.media3.session.MediaSessionService;

import com.google.common.collect.ImmutableList;
import com.google.common.util.concurrent.Futures;
import com.google.common.util.concurrent.ListenableFuture;

import java.util.ArrayList;
import java.util.List;

/**
 * The single owner of audio playback. Runs as a foreground mediaPlayback service so playback survives
 * screen lock, backgrounding and task removal. Exposes a MediaSession (lock screen, notification,
 * Bluetooth, Android Auto-style controllers all talk to it). Handles audio focus, becoming-noisy
 * (headphone unplug) and wake locks through ExoPlayer.
 */
@UnstableApi
public class PlaybackService extends MediaSessionService {
    static volatile PlaybackService instance;

    private ExoPlayer player;
    private MediaSession session;
    private Equalizer eq;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private long sleepAt = 0;
    private int tickCount = 0;
    private int errorStreak = 0;

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        AudioAttributes attrs = new AudioAttributes.Builder()
            .setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MUSIC).build();
        player = new ExoPlayer.Builder(this)
            .setAudioAttributes(attrs, /* handleAudioFocus= */ true)  // pauses for calls / other apps, resumes after
            .setHandleAudioBecomingNoisy(true)                         // pauses on headphone / BT disconnect
            .setWakeMode(C.WAKE_MODE_NETWORK)                          // keep CPU + Wi-Fi alive while locked
            .build();
        player.addListener(new Listener());

        Intent launch = getPackageManager().getLaunchIntentForPackage(getPackageName());
        PendingIntent activity = PendingIntent.getActivity(this, 0, launch, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        session = new MediaSession.Builder(this, player).setCallback(new Callback()).setSessionActivity(activity).build();

        applySettings();
        rebuildEq(player.getAudioSessionId());
        handler.postDelayed(tick, 250);
    }

    @Nullable
    @Override
    public MediaSession onGetSession(MediaSession.ControllerInfo controllerInfo) {
        return session; // one session for every controller -> no duplicate sessions
    }

    @Override
    public void onTaskRemoved(@Nullable Intent rootIntent) {
        // Swiped from recents: keep playing if music is playing, otherwise shut down.
        if (!player.getPlayWhenReady() || player.getMediaItemCount() == 0 || player.getPlaybackState() == Player.STATE_ENDED) {
            stopSelf();
        }
    }

    @Override
    public void onDestroy() {
        instance = null;
        handler.removeCallbacksAndMessages(null);
        saveQueueNow();
        if (eq != null) { try { eq.release(); } catch (Exception ignored) { } eq = null; }
        if (session != null) { session.release(); session = null; }
        if (player != null) { player.release(); player = null; }
        super.onDestroy();
    }

    // ---------- settings (called from the plugin on the main thread) ----------
    void applySettings() {
        if (player == null) return;
        applyEq();
        applyVolume(1f);
    }

    void setSleepAt(long atMillis) { sleepAt = atMillis; }

    private float fade = 1f;
    private void applyVolume(float fadeFactor) {
        fade = fadeFactor;
        if (player != null) player.setVolume(Math.max(0f, Math.min(1f, PlayerPrefs.volume(this) * fadeFactor)));
    }

    private void rebuildEq(int sessionId) {
        if (eq != null) { try { eq.release(); } catch (Exception ignored) { } eq = null; }
        if (sessionId == C.AUDIO_SESSION_ID_UNSET || sessionId == 0) return;
        try { eq = new Equalizer(0, sessionId); applyEq(); } catch (Exception e) { eq = null; }
    }

    private void applyEq() {
        if (eq == null) return;
        try {
            float[] g = PlayerPrefs.eq(this);
            boolean any = false;
            for (float v : g) if (v != 0f) any = true;
            short n = eq.getNumberOfBands();
            short[] range = eq.getBandLevelRange();
            for (int i = 0; i < 5; i++) {
                short band = (short) Math.round(i * (n - 1) / 4.0);
                int level = Math.round(g[i] * 100f);
                eq.setBandLevel(band, (short) Math.max(range[0], Math.min(range[1], level)));
            }
            eq.setEnabled(any);
        } catch (Exception ignored) { }
    }

    // ---------- periodic work: sleep timer, crossfade, position persistence ----------
    private final Runnable tick = new Runnable() {
        @Override public void run() {
            if (player == null) return;
            long now = System.currentTimeMillis();
            if (sleepAt > 0 && now >= sleepAt) { sleepAt = 0; player.pause(); }

            int cf = PlayerPrefs.crossfade(PlaybackService.this);
            long dur = player.getDuration();
            if (cf > 0 && player.isPlaying() && dur != C.TIME_UNSET && dur > 0) {
                float pos = player.getCurrentPosition() / 1000f, left = (dur - player.getCurrentPosition()) / 1000f;
                float f = 1f;
                boolean repeatOne = player.getRepeatMode() == Player.REPEAT_MODE_ONE;
                if (!repeatOne && left < cf) f = Math.max(0f, left / cf);
                else if (pos < Math.min(cf, 3)) f = Math.min(1f, pos / Math.min(cf, 3));
                applyVolume(f);
            } else if (fade != 1f) applyVolume(1f);

            if (++tickCount % 20 == 0 && player.getMediaItemCount() > 0) {
                PlayerPrefs.savePosition(PlaybackService.this, player.getCurrentMediaItemIndex(), player.getCurrentPosition());
            }
            handler.postDelayed(this, 250);
        }
    };

    private void saveQueueNow() {
        if (player == null || player.getMediaItemCount() == 0) return;
        List<MediaItem> items = new ArrayList<>();
        for (int i = 0; i < player.getMediaItemCount(); i++) items.add(player.getMediaItemAt(i));
        PlayerPrefs.saveQueue(this, items, player.getCurrentMediaItemIndex(), player.getCurrentPosition());
    }

    private final class Listener implements Player.Listener {
        @Override public void onAudioSessionIdChanged(int audioSessionId) { rebuildEq(audioSessionId); }
        @Override public void onTimelineChanged(androidx.media3.common.Timeline t, int reason) { saveQueueNow(); }
        @Override public void onMediaItemTransition(@Nullable MediaItem item, int reason) { saveQueueNow(); }
        @Override public void onIsPlayingChanged(boolean isPlaying) { if (isPlaying) errorStreak = 0; else saveQueueNow(); }
        @Override public void onPlayerError(PlaybackException error) {
            // A dead URL / deleted file must not stall the queue: skip to the next item (bounded to avoid loops).
            if (++errorStreak <= Math.max(1, player.getMediaItemCount()) && player.hasNextMediaItem()) {
                player.seekToNextMediaItem(); player.prepare(); player.play();
            }
        }
    }

    private final class Callback implements MediaSession.Callback {
        @Override
        public ListenableFuture<List<MediaItem>> onAddMediaItems(MediaSession s, MediaSession.ControllerInfo c, List<MediaItem> items) {
            // Controllers can strip the URI; restore it from request metadata.
            List<MediaItem> out = new ArrayList<>();
            for (MediaItem m : items) {
                if (m.localConfiguration == null && m.requestMetadata.mediaUri != null) out.add(m.buildUpon().setUri(m.requestMetadata.mediaUri).build());
                else out.add(m);
            }
            return Futures.immediateFuture(out);
        }

        @Override
        public ListenableFuture<MediaSession.MediaItemsWithStartPosition> onPlaybackResumption(MediaSession s, MediaSession.ControllerInfo c) {
            // Bluetooth / lock-screen "play" after the service was killed or the device rebooted.
            PlayerPrefs.Saved sv = PlayerPrefs.loadQueue(PlaybackService.this);
            if (sv.items.isEmpty()) return Futures.immediateFailedFuture(new UnsupportedOperationException("nothing to resume"));
            return Futures.immediateFuture(new MediaSession.MediaItemsWithStartPosition(ImmutableList.copyOf(sv.items), sv.index, sv.pos));
        }
    }
}
