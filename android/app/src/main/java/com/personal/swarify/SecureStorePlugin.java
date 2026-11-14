package com.personal.swarify;

import android.content.SharedPreferences;

import androidx.security.crypto.EncryptedSharedPreferences;
import androidx.security.crypto.MasterKey;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Key/value store encrypted with an Android Keystore master key (AES-256). Used for OAuth tokens. */
@CapacitorPlugin(name = "SecureStore")
public class SecureStorePlugin extends Plugin {
    private SharedPreferences prefs;

    private synchronized SharedPreferences prefs() throws Exception {
        if (prefs == null) {
            MasterKey key = new MasterKey.Builder(getContext()).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build();
            prefs = EncryptedSharedPreferences.create(getContext(), "swarify_secure", key,
                EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM);
        }
        return prefs;
    }

    @PluginMethod
    public void get(PluginCall call) {
        try {
            String v = prefs().getString(call.getString("key", ""), null);
            JSObject o = new JSObject(); o.put("value", v); call.resolve(o);
        } catch (Exception e) { call.reject("secure read failed: " + e.getMessage()); }
    }

    @PluginMethod
    public void set(PluginCall call) {
        try { prefs().edit().putString(call.getString("key", ""), call.getString("value", "")).apply(); call.resolve(); }
        catch (Exception e) { call.reject("secure write failed: " + e.getMessage()); }
    }

    @PluginMethod
    public void remove(PluginCall call) {
        try { prefs().edit().remove(call.getString("key", "")).apply(); call.resolve(); }
        catch (Exception e) { call.reject("secure delete failed: " + e.getMessage()); }
    }
}
