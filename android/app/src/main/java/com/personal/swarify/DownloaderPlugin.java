package com.personal.swarify;

import android.content.ContentResolver;
import android.content.ContentUris;
import android.content.ContentValues;
import android.content.Context;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.os.ParcelFileDescriptor;
import android.os.StatFs;
import android.provider.MediaStore;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.channels.FileChannel;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Authorised-download worker. Files go to MediaStore (scoped storage, no storage permission needed):
 * Music/Swarify/<Artist>/<Album>/<Title>.<ext>, written as a "pending" item so half-files never show up as songs.
 * Interrupted downloads resume with an HTTP Range request from the saved offset.
 */
@CapacitorPlugin(name = "Downloader")
public class DownloaderPlugin extends Plugin {
    private final ExecutorService pool = Executors.newFixedThreadPool(3);
    private final Map<String, AtomicInteger> flags = new ConcurrentHashMap<>();   // 0 run · 1 cancel+discard · 2 cancel+keep partial
    private final AtomicInteger active = new AtomicInteger();
    private final Handler main = new Handler(Looper.getMainLooper());
    private final Runnable stopSvc = new Runnable() { @Override public void run() { if (active.get() == 0) DownloadService.stop(getContext()); } };

    private SharedPreferences prefs() { return getContext().getSharedPreferences("swarify_dl", Context.MODE_PRIVATE); }

    private static String clean(String s, String fallback) {
        String t = s == null ? "" : s.replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]", "_").replaceAll("\\s+", " ").trim();
        if (t.length() > 80) t = t.substring(0, 80).trim();
        return t.isEmpty() ? fallback : t;
    }
    private static String mime(String ext) {
        switch (ext.toLowerCase()) { case "flac": return "audio/flac"; case "ogg": return "audio/ogg"; case "m4a": return "audio/mp4"; case "wav": return "audio/x-wav"; default: return "audio/mpeg"; }
    }
    private static boolean looksLikeAudio(byte[] b, int n) {
        if (n < 12) return false;
        String h4 = new String(b, 0, 4, java.nio.charset.StandardCharsets.ISO_8859_1);
        String h48 = new String(b, 4, 4, java.nio.charset.StandardCharsets.ISO_8859_1);
        return h4.startsWith("ID3") || ((b[0] & 0xff) == 0xff && (b[1] & 0xe0) == 0xe0) || h4.equals("fLaC") || h4.equals("OggS") || h4.equals("RIFF") || h48.equals("ftyp");
    }

    // ---------------------------------------------------------------- download
    @PluginMethod
    public void download(final PluginCall call) {
        final String id = call.getString("id", "");
        flags.put(id, new AtomicInteger(0));
        final int n = active.incrementAndGet();
        main.removeCallbacks(stopSvc);
        DownloadService.start(getContext(), n);
        pool.execute(() -> {
            try { doDownload(call, id); }
            catch (Exception e) { call.reject(String.valueOf(e.getMessage()), "NETWORK"); }
            finally {
                flags.remove(id);
                // Never stop a foreground service immediately after starting it: if Android has not yet run its startForeground(), the app is killed.
                if (active.decrementAndGet() == 0) { main.removeCallbacks(stopSvc); main.postDelayed(stopSvc, 3000); }
                else DownloadService.start(getContext(), active.get());
            }
        });
    }

    private void doDownload(PluginCall call, String id) throws Exception {
        if (Build.VERSION.SDK_INT < 29) { call.reject("Downloads need Android 10 or newer", "STORAGE"); return; }
        final String url = call.getString("url", ""), title = call.getString("title", "Unknown"), artist = call.getString("artist", ""), album = call.getString("album", "");
        final String ext = call.getString("ext", "mp3"); final long expected = call.getData().optLong("expectedBytes", 0);
        ContentResolver cr = getContext().getContentResolver();
        SharedPreferences sp = prefs(); long written = 0; Uri uri = null;

        // resume an earlier partial download if its pending item still exists
        String saved = sp.getString(id, null);
        if (saved != null) {
            try { JSONObject j = new JSONObject(saved); Uri u = Uri.parse(j.getString("uri")); try (Cursor c = cr.query(u, new String[]{MediaStore.MediaColumns.SIZE}, null, null, null)) { if (c != null && c.moveToFirst()) { uri = u; written = j.getLong("written"); } } } catch (Exception ignored) { }
        }
        if (uri == null) {
            ContentValues v = new ContentValues();
            v.put(MediaStore.Audio.Media.DISPLAY_NAME, clean(title, "Unknown") + "." + ext);
            v.put(MediaStore.Audio.Media.MIME_TYPE, mime(ext));
            v.put(MediaStore.Audio.Media.RELATIVE_PATH, "Music/Swarify/" + clean(artist, "Unknown artist") + "/" + clean(album, "Singles"));
            v.put(MediaStore.Audio.Media.TITLE, title); v.put(MediaStore.Audio.Media.ARTIST, artist.isEmpty() ? "Unknown artist" : artist); v.put(MediaStore.Audio.Media.ALBUM, album.isEmpty() ? "Singles" : album);
            v.put(MediaStore.Audio.Media.IS_MUSIC, 1); v.put(MediaStore.Audio.Media.IS_PENDING, 1);
            uri = cr.insert(MediaStore.Audio.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY), v);
            if (uri == null) { call.reject("Could not create the file in Music/Swarify", "STORAGE"); return; }
            written = 0;
        }

        HttpURLConnection c = null; String cur = url; int code = 0;
        for (int hop = 0; hop < 6; hop++) {
            c = (HttpURLConnection) new URL(cur).openConnection();
            c.setInstanceFollowRedirects(false); c.setConnectTimeout(15000); c.setReadTimeout(30000);
            c.setRequestProperty("User-Agent", "Swarify/1.0 (personal music player)");
            if (written > 0) c.setRequestProperty("Range", "bytes=" + written + "-");
            code = c.getResponseCode();
            if (code >= 300 && code < 400) { String loc = c.getHeaderField("Location"); c.disconnect(); if (loc == null) break; cur = new URL(new URL(cur), loc).toString(); continue; }
            break;
        }
        if (c == null || (code != 200 && code != 206)) {
            if (c != null) c.disconnect();
            if (code == 404 || code == 403 || code == 410 || code == 401) { cr.delete(uri, null, null); sp.edit().remove(id).apply(); }
            call.reject("HTTP " + code, "HTTP"); return;
        }
        if (code == 200) written = 0;                                          // server ignored Range → start over
        long len = c.getContentLengthLong(); long total = len > 0 ? len + written : (expected > 0 ? expected : 0);
        if (total > 0) { StatFs fs = new StatFs(Environment.getExternalStorageDirectory().getPath()); if (fs.getAvailableBytes() < (total - written) + 20L * 1024 * 1024) { c.disconnect(); call.reject("Not enough free space", "STORAGE"); return; } }

        ParcelFileDescriptor pfd = cr.openFileDescriptor(uri, "rw");
        if (pfd == null) { c.disconnect(); call.reject("Cannot open the output file", "STORAGE"); return; }
        FileOutputStream fos = new FileOutputStream(pfd.getFileDescriptor()); FileChannel ch = fos.getChannel(); ch.truncate(written); ch.position(written);
        InputStream in = c.getInputStream(); byte[] buf = new byte[64 * 1024]; long lastEvt = 0, lastSave = written; int r; AtomicInteger flag = flags.get(id);
        boolean cancelled = false;
        try {
            while ((r = in.read(buf)) != -1) {
                fos.write(buf, 0, r); written += r;
                long now = System.currentTimeMillis();
                if (now - lastEvt > 300) { lastEvt = now; JSObject e = new JSObject(); e.put("id", id); e.put("bytes", written); e.put("total", total); notifyListeners("progress", e); }
                if (written - lastSave > 1024 * 1024) { lastSave = written; sp.edit().putString(id, new JSONObject().put("uri", uri.toString()).put("written", written).toString()).apply(); }
                if (flag != null && flag.get() != 0) { cancelled = true; break; }
            }
        } catch (Exception e) {
            sp.edit().putString(id, new JSONObject().put("uri", uri.toString()).put("written", written).toString()).apply();   // keep progress for resume
            try { fos.getFD().sync(); } catch (Exception ignored) { }
            fos.close(); pfd.close(); c.disconnect();
            call.reject("Connection lost: " + e.getMessage(), "NETWORK"); return;
        }
        try { fos.getFD().sync(); } catch (Exception ignored) { }
        fos.close(); pfd.close(); c.disconnect();

        if (cancelled) {
            if (flag.get() == 1) { cr.delete(uri, null, null); sp.edit().remove(id).apply(); }
            else sp.edit().putString(id, new JSONObject().put("uri", uri.toString()).put("written", written).toString()).apply();
            call.reject("Cancelled", "CANCELLED"); return;
        }
        sp.edit().putString(id, new JSONObject().put("uri", uri.toString()).put("written", written).toString()).apply();
        if (total > 0 && written != total) { call.reject("Incomplete download (" + written + "/" + total + " bytes)", "NETWORK"); return; }

        // integrity: must start like real audio
        byte[] head = new byte[16]; int hn = 0;
        try (InputStream chk = cr.openInputStream(uri)) { if (chk != null) hn = chk.read(head); }
        if (!looksLikeAudio(head, hn)) { cr.delete(uri, null, null); sp.edit().remove(id).apply(); call.reject("The file is not recognisable audio (bad header)", "INTEGRITY"); return; }

        ContentValues done = new ContentValues(); done.put(MediaStore.Audio.Media.IS_PENDING, 0); cr.update(uri, done, null, null);
        sp.edit().remove(id).apply();
        long mediaId = ContentUris.parseId(uri);
        JSObject res = new JSObject();
        res.put("id", String.valueOf(mediaId)); res.put("uri", ContentUris.withAppendedId(MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, mediaId).toString());
        res.put("size", written); res.put("folder", "Music/Swarify/" + clean(artist, "Unknown artist") + "/" + clean(album, "Singles"));
        call.resolve(res);
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        AtomicInteger f = flags.get(call.getString("id", ""));
        if (f != null) f.set(call.getBoolean("keepPartial", false) ? 2 : 1);
        call.resolve();
    }

    @PluginMethod
    public void discard(PluginCall call) {
        String id = call.getString("id", ""); SharedPreferences sp = prefs(); String saved = sp.getString(id, null);
        if (saved != null) { try { getContext().getContentResolver().delete(Uri.parse(new JSONObject(saved).getString("uri")), null, null); } catch (Exception ignored) { } sp.edit().remove(id).apply(); }
        call.resolve();
    }

    @PluginMethod
    public void storage(PluginCall call) {
        StatFs fs = new StatFs(Environment.getExternalStorageDirectory().getPath());
        JSObject o = new JSObject(); o.put("freeBytes", fs.getAvailableBytes()); call.resolve(o);
    }

    @PluginMethod
    public void network(PluginCall call) {
        boolean unmetered = false;
        try {
            ConnectivityManager cm = (ConnectivityManager) getContext().getSystemService(Context.CONNECTIVITY_SERVICE);
            Network n = cm.getActiveNetwork(); NetworkCapabilities caps = n == null ? null : cm.getNetworkCapabilities(n);
            unmetered = caps != null && caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED) && caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET);
        } catch (Exception ignored) { }
        JSObject o = new JSObject(); o.put("unmetered", unmetered); call.resolve(o);
    }
}
