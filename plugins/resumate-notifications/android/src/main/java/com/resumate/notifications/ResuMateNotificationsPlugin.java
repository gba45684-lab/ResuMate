package com.resumate.notifications;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.provider.MediaStore;

import androidx.core.app.ActivityCompat;
import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;
import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.util.Locale;
import java.util.UUID;

@CapacitorPlugin(name = "ResuMateNotifications")
public class ResuMateNotificationsPlugin extends Plugin {
    private static final String CHANNEL_ID = "resumate_downloads";
    private static final int NOTIFICATION_PERMISSION_REQUEST = 7341;
    private static final String AUTH_SUFFIX = ".fileprovider";

    @Override
    public void load() {
        super.load();
        applySystemBars();
    }

    private void applySystemBars() {
        try {
            if (getActivity() == null) return;
            getActivity().runOnUiThread(() -> {
                try {
                    android.view.Window window = getActivity().getWindow();
                    window.setStatusBarColor(Color.BLACK);
                    window.setNavigationBarColor(Color.rgb(243, 238, 222));
                    if (Build.VERSION.SDK_INT >= 23) {
                        int flags = window.getDecorView().getSystemUiVisibility();
                        flags &= ~android.view.View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
                        if (Build.VERSION.SDK_INT >= 26) flags |= android.view.View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
                        window.getDecorView().setSystemUiVisibility(flags);
                    }
                } catch (Exception ignored) {}
            });
        } catch (Exception ignored) {}
    }

    @PluginMethod
    public void saveAndNotify(PluginCall call) {
        String filename = call.getString("filename", "ResuMate-document.pdf");
        String mime = call.getString("mimeType", "application/octet-stream");
        String base64 = call.getString("dataBase64", "");
        if (base64.startsWith("data:")) {
            int comma = base64.indexOf(',');
            if (comma >= 0) base64 = base64.substring(comma + 1);
        }
        if (base64.isEmpty()) { call.reject("Document data is empty"); return; }

        try {
            byte[] data = android.util.Base64.decode(base64, android.util.Base64.DEFAULT);
            Uri uri = persistDocument(filename, mime, data);
            ensureChannel();
            if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(getContext(), Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                if (getActivity() != null) {
                    ActivityCompat.requestPermissions(getActivity(), new String[]{Manifest.permission.POST_NOTIFICATIONS}, NOTIFICATION_PERMISSION_REQUEST);
                    new Handler(Looper.getMainLooper()).postDelayed(() -> postNotificationIfAllowed(filename, mime, uri), 1800);
                }
            } else postNotificationIfAllowed(filename, mime, uri);

            JSObject result = new JSObject();
            result.put("saved", true); result.put("filename", filename); result.put("uri", uri.toString());
            call.resolve(result);
        } catch (Exception e) { call.reject("Could not save document: " + e.getMessage(), e); }
    }

    @PluginMethod
    public void requestNotificationPermission(PluginCall call) {
        if (Build.VERSION.SDK_INT < 33 || ContextCompat.checkSelfPermission(getContext(), Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) {
            JSObject result = new JSObject(); result.put("granted", true); call.resolve(result); return;
        }
        if (getActivity() == null) { call.reject("No Android activity available"); return; }
        ActivityCompat.requestPermissions(getActivity(), new String[]{Manifest.permission.POST_NOTIFICATIONS}, NOTIFICATION_PERMISSION_REQUEST);
        JSObject result = new JSObject(); result.put("granted", false); result.put("requested", true); call.resolve(result);
    }

    private Uri persistDocument(String filename, String mime, byte[] data) throws Exception {
        String safe = filename.replaceAll("[\\\\/:*?\"<>|]", "_");
        if (Build.VERSION.SDK_INT >= 29) {
            ContentResolver resolver = getContext().getContentResolver();
            ContentValues values = new ContentValues();
            values.put(MediaStore.Downloads.DISPLAY_NAME, safe);
            values.put(MediaStore.Downloads.MIME_TYPE, mime);
            values.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/ResuMate");
            values.put(MediaStore.Downloads.IS_PENDING, 1);
            Uri uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
            if (uri == null) throw new Exception("MediaStore insert failed");
            try (OutputStream out = resolver.openOutputStream(uri)) {
                if (out == null) throw new Exception("Could not open download stream");
                out.write(data); out.flush();
            }
            ContentValues done = new ContentValues(); done.put(MediaStore.Downloads.IS_PENDING, 0);
            resolver.update(uri, done, null, null);
            return uri;
        }
        File dir = getContext().getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
        if (dir == null) throw new Exception("External downloads directory unavailable");
        if (!dir.exists() && !dir.mkdirs()) throw new Exception("Could not create downloads directory");
        File file = new File(dir, UUID.randomUUID().toString() + "-" + safe);
        try (FileOutputStream out = new FileOutputStream(file)) { out.write(data); out.flush(); }
        return FileProvider.getUriForFile(getContext(), getContext().getPackageName() + AUTH_SUFFIX, file);
    }

    private void ensureChannel() {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = (NotificationManager) getContext().getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "ResuMate downloads", NotificationManager.IMPORTANCE_HIGH);
        channel.setDescription("Notifications when ResuMate documents are saved");
        channel.enableVibration(true); channel.setVibrationPattern(new long[]{0, 120, 70, 120});
        nm.createNotificationChannel(channel);
    }

    private void postNotificationIfAllowed(String filename, String mime, Uri uri) {
        if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(getContext(), Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return;
        NotificationManager nm = (NotificationManager) getContext().getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0);
        Intent open = new Intent(Intent.ACTION_VIEW); open.setDataAndType(uri, mime); open.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
        PendingIntent openPending = PendingIntent.getActivity(getContext(), filename.hashCode(), open, flags);
        Intent share = new Intent(Intent.ACTION_SEND); share.setType(mime); share.putExtra(Intent.EXTRA_STREAM, uri); share.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        PendingIntent sharePending = PendingIntent.getActivity(getContext(), filename.hashCode() + 1, Intent.createChooser(share, "Share document"), flags);
        int icon = getContext().getApplicationInfo().icon; if (icon == 0) icon = android.R.drawable.stat_sys_download_done;
        NotificationCompat.Builder builder = new NotificationCompat.Builder(getContext(), CHANNEL_ID)
            .setSmallIcon(icon).setContentTitle("Document saved").setContentText(filename)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(String.format(Locale.getDefault(), "%s is ready. Tap to open.", filename)))
            .setContentIntent(openPending).addAction(android.R.drawable.ic_menu_view, "Open", openPending)
            .addAction(android.R.drawable.ic_menu_share, "Share", sharePending).setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_HIGH).setCategory(NotificationCompat.CATEGORY_PROGRESS)
            .setVibrate(new long[]{0, 120, 70, 120});
        nm.notify(Math.abs((filename + System.currentTimeMillis()).hashCode()), builder.build());
    }
}
