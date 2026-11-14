package com.personal.swarify;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;

import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;

/** Keeps the process alive (foreground, dataSync) while files are downloading. */
public class DownloadService extends Service {
    private static final String CHANNEL = "swarify_downloads";
    private static final int ID = 4107;

    static void start(Context c, int count) {
        Intent i = new Intent(c, DownloadService.class).putExtra("count", count);
        ContextCompat.startForegroundService(c, i);
    }
    static void stop(Context c) { c.stopService(new Intent(c, DownloadService.class)); }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        int count = intent != null ? intent.getIntExtra("count", 1) : 1;
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(CHANNEL) == null) {
            nm.createNotificationChannel(new NotificationChannel(CHANNEL, "Downloads", NotificationManager.IMPORTANCE_LOW));
        }
        Notification n = new NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(android.R.drawable.stat_sys_download).setContentTitle("Swarify")
            .setContentText(count + (count == 1 ? " song downloading" : " songs downloading")).setOngoing(true).setOnlyAlertOnce(true).build();
        if (Build.VERSION.SDK_INT >= 29) startForeground(ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
        else startForeground(ID, n);
        return START_NOT_STICKY;
    }

    @Override public IBinder onBind(Intent intent) { return null; }
}
