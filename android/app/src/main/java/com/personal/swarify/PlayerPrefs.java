package com.personal.swarify;

import android.content.Context;
import android.content.SharedPreferences;
import android.net.Uri;

import androidx.media3.common.MediaItem;
import androidx.media3.common.MediaMetadata;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/** Native-side persistence so the service can restore itself with no JavaScript running. */
final class PlayerPrefs {
    private PlayerPrefs() {}

    static SharedPreferences sp(Context c) { return c.getSharedPreferences("swarify_native", Context.MODE_PRIVATE); }

    static float[] eq(Context c) {
        String[] p = sp(c).getString("eq", "0,0,0,0,0").split(",");
        float[] g = new float[5];
        for (int i = 0; i < 5 && i < p.length; i++) { try { g[i] = Float.parseFloat(p[i]); } catch (Exception ignored) { } }
        return g;
    }
    static void setEq(Context c, float[] g) {
        StringBuilder b = new StringBuilder();
        for (int i = 0; i < g.length; i++) { if (i > 0) b.append(','); b.append(g[i]); }
        sp(c).edit().putString("eq", b.toString()).apply();
    }
    static int crossfade(Context c) { return sp(c).getInt("crossfade", 0); }
    static float volume(Context c) { return sp(c).getFloat("volume", 1f); }

    static void saveQueue(Context c, List<MediaItem> items, int index, long posMs) {
        try {
            JSONArray a = new JSONArray();
            for (MediaItem m : items) {
                JSONObject o = new JSONObject();
                o.put("id", m.mediaId);
                o.put("title", String.valueOf(m.mediaMetadata.title));
                o.put("artist", String.valueOf(m.mediaMetadata.artist));
                o.put("album", m.mediaMetadata.albumTitle == null ? "" : String.valueOf(m.mediaMetadata.albumTitle));
                o.put("art", m.mediaMetadata.artworkUri == null ? "" : m.mediaMetadata.artworkUri.toString());
                o.put("url", m.localConfiguration == null ? "" : m.localConfiguration.uri.toString());
                a.put(o);
            }
            sp(c).edit().putString("queue", a.toString()).putInt("index", index).putLong("pos", posMs).apply();
        } catch (Exception ignored) { }
    }
    static void savePosition(Context c, int index, long posMs) {
        sp(c).edit().putInt("index", index).putLong("pos", posMs).apply();
    }

    static final class Saved { List<MediaItem> items = new ArrayList<>(); int index; long pos; }

    static Saved loadQueue(Context c) {
        Saved s = new Saved();
        try {
            JSONArray a = new JSONArray(sp(c).getString("queue", "[]"));
            for (int i = 0; i < a.length(); i++) s.items.add(item(a.getJSONObject(i)));
            s.index = Math.max(0, Math.min(sp(c).getInt("index", 0), Math.max(0, s.items.size() - 1)));
            s.pos = sp(c).getLong("pos", 0);
        } catch (Exception ignored) { s.items.clear(); }
        return s;
    }

    static MediaItem item(JSONObject o) throws Exception {
        String url = o.getString("url");
        String art = o.optString("art", "");
        MediaMetadata md = new MediaMetadata.Builder()
            .setTitle(o.optString("title", ""))
            .setArtist(o.optString("artist", ""))
            .setAlbumTitle(o.optString("album", ""))
            .setArtworkUri(art.matches("^(https?|content|file)://.*") ? Uri.parse(art) : null)
            .setIsPlayable(true).build();
        return new MediaItem.Builder()
            .setMediaId(o.getString("id")).setUri(url).setMediaMetadata(md)
            .setRequestMetadata(new MediaItem.RequestMetadata.Builder().setMediaUri(Uri.parse(url)).build())
            .build();
    }
}
