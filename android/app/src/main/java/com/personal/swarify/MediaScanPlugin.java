package com.personal.swarify;

import android.Manifest;
import android.content.ContentUris;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.provider.MediaStore;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/** Scans the device's MediaStore for every music file (all folders, SD card included). */
@CapacitorPlugin(
    name = "MediaScan",
    permissions = {
        @Permission(strings = { Manifest.permission.READ_MEDIA_AUDIO }, alias = "audio33"),
        @Permission(strings = { Manifest.permission.READ_EXTERNAL_STORAGE }, alias = "audioLegacy")
    }
)
public class MediaScanPlugin extends Plugin {

    private String alias() {
        return Build.VERSION.SDK_INT >= 33 ? "audio33" : "audioLegacy";
    }

    @PluginMethod
    public void scan(PluginCall call) {
        if (getPermissionState(alias()) != PermissionState.GRANTED) {
            requestPermissionForAlias(alias(), call, "onPermission");
            return;
        }
        runScan(call);
    }

    @PermissionCallback
    private void onPermission(PluginCall call) {
        if (getPermissionState(alias()) == PermissionState.GRANTED) runScan(call);
        else call.reject("Storage permission denied. Allow 'Music and audio' for Swarify in Android settings.");
    }

    private void runScan(final PluginCall call) {
        new Thread(() -> {
            try {
                JSArray out = new JSArray();
                Uri base = MediaStore.Audio.Media.EXTERNAL_CONTENT_URI;
                List<String> proj = new ArrayList<>(Arrays.asList(
                    MediaStore.Audio.Media._ID, MediaStore.Audio.Media.TITLE, MediaStore.Audio.Media.ARTIST,
                    MediaStore.Audio.Media.ALBUM, MediaStore.Audio.Media.ALBUM_ID, MediaStore.Audio.Media.DURATION,
                    MediaStore.Audio.Media.DATA, MediaStore.Audio.Media.SIZE, MediaStore.Audio.Media.YEAR));
                if (Build.VERSION.SDK_INT >= 30) proj.add(MediaStore.Audio.AudioColumns.GENRE);
                // Music flagged by Android, OR common music formats anywhere (e.g. Download/), minus ringtones,
                // alarms, voice notes and recordings.
                String sel = "(" + MediaStore.Audio.Media.IS_MUSIC + " != 0 OR " + MediaStore.Audio.Media.MIME_TYPE
                    + " IN ('audio/mpeg','audio/mp4','audio/flac','audio/x-flac','audio/aac','audio/x-wav','audio/wav','audio/x-ms-wma'))"
                    + " AND " + MediaStore.Audio.Media.IS_RINGTONE + " = 0 AND " + MediaStore.Audio.Media.IS_NOTIFICATION + " = 0 AND "
                    + MediaStore.Audio.Media.IS_ALARM + " = 0 AND " + MediaStore.Audio.Media.DURATION + " >= 20000"
                    + " AND " + MediaStore.Audio.Media.DATA + " NOT LIKE '%/WhatsApp/%' AND " + MediaStore.Audio.Media.DATA + " NOT LIKE '%/Recordings/%'";
                try (Cursor c = getContext().getContentResolver().query(base, proj.toArray(new String[0]), sel, null,
                        MediaStore.Audio.Media.TITLE + " COLLATE NOCASE ASC")) {
                    if (c != null) {
                        while (c.moveToNext()) {
                            long id = c.getLong(0);
                            JSObject o = new JSObject();
                            o.put("id", id);
                            o.put("title", c.getString(1));
                            String artist = c.getString(2);
                            o.put("artist", (artist == null || artist.equals("<unknown>")) ? "Unknown artist" : artist);
                            o.put("album", c.getString(3));
                            o.put("albumId", c.getLong(4));
                            o.put("duration", c.getLong(5) / 1000);
                            o.put("uri", ContentUris.withAppendedId(base, id).toString());
                            String path = c.getString(6);
                            String folder = "";
                            if (path != null) {
                                int i = path.lastIndexOf('/');
                                folder = i > 0 ? path.substring(0, i) : "";
                            }
                            o.put("folder", folder);
                            o.put("size", c.getLong(c.getColumnIndexOrThrow(MediaStore.Audio.Media.SIZE)));
                            o.put("year", c.getInt(c.getColumnIndexOrThrow(MediaStore.Audio.Media.YEAR)));
                            if (Build.VERSION.SDK_INT >= 30) {
                                int gi = c.getColumnIndex(MediaStore.Audio.AudioColumns.GENRE);
                                if (gi >= 0 && !c.isNull(gi)) o.put("genre", c.getString(gi));
                            }
                            out.put(o);
                        }
                    }
                }
                JSObject res = new JSObject();
                res.put("tracks", out);
                call.resolve(res);
            } catch (Exception e) {
                call.reject("Scan failed: " + e.getMessage());
            }
        }).start();
    }
}
