package com.synchronireactnativedemo

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.Settings
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

// All-files access for the SDK session logs and the .bin export under
// /sdcard/Documents/sensorsdklog (Kotlin demo MainActivity.requestStorageAccess
// parity): API 30+ jumps to the system settings page; nothing to do below.
class DemoStorageModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = "DemoStorage"

  @ReactMethod(isBlockingSynchronousMethod = true)
  fun isAllFilesAccessGranted(): Boolean {
    return Build.VERSION.SDK_INT < 30 || Environment.isExternalStorageManager()
  }

  @ReactMethod
  fun requestAllFilesAccess() {
    if (Build.VERSION.SDK_INT < 30 || Environment.isExternalStorageManager()) {
      return
    }
    val context = reactApplicationContext
    try {
      context.startActivity(
        Intent(
          Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION,
          Uri.parse("package:${context.packageName}")
        ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      )
    } catch (e: Exception) {
      context.startActivity(
        Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION)
          .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      )
    }
  }
}
