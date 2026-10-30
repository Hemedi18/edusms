package com.edusms.edusms_mobile

import android.Manifest
import android.app.Activity
import android.app.role.RoleManager
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.provider.Telephony
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.EventChannel
import io.flutter.plugin.common.MethodCall
import io.flutter.plugin.common.MethodChannel
import java.util.concurrent.Executors

class MainActivity : FlutterActivity() {

    companion object {
        private const val METHOD_CHANNEL_NAME = "com.edusms.gateway/methods"
        private const val EVENT_CHANNEL_NAME = "com.edusms.gateway/events"
        private const val REQ_CODE_GATEWAY_PERMISSIONS = 7101
        private const val REQ_CODE_DEFAULT_SMS_ROLE = 7102
    }

    private val ioExecutor = Executors.newSingleThreadExecutor()
    private var pendingPermissionsResult: MethodChannel.Result? = null
    private var pendingDefaultSmsRoleResult: MethodChannel.Result? = null

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)

        EventChannel(flutterEngine.dartExecutor.binaryMessenger, EVENT_CHANNEL_NAME)
            .setStreamHandler(GatewayEventBus)

        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, METHOD_CHANNEL_NAME)
            .setMethodCallHandler { call, result ->
                handleGatewayMethodCall(call, result)
            }
    }

    private fun handleGatewayMethodCall(call: MethodCall, result: MethodChannel.Result) {
        when (call.method) {
            "getDiagnostics" -> {
                result.success(TelephonyDiagnostics.collectDiagnosticsMap(this))
            }

            "requestPermissions" -> {
                if (pendingPermissionsResult != null) {
                    result.error("ALREADY_REQUESTING", "A permission request is already active.", null)
                    return
                }
                val requested = mutableListOf(
                    Manifest.permission.SEND_SMS,
                    Manifest.permission.RECEIVE_SMS,
                    Manifest.permission.READ_SMS,
                    Manifest.permission.READ_PHONE_STATE,
                )
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    requested.add(Manifest.permission.POST_NOTIFICATIONS)
                }
                val missing = requested.filter { !TelephonyDiagnostics.hasPermission(this, it) }
                if (missing.isEmpty()) {
                    result.success(TelephonyDiagnostics.checkPermissions(this))
                } else {
                    pendingPermissionsResult = result
                    requestPermissions(missing.toTypedArray(), REQ_CODE_GATEWAY_PERMISSIONS)
                }
            }

            "configureGateway" -> {
                val apiBaseUrl = call.argument<String>("apiBaseUrl")
                val gatewayToken = call.argument<String>("gatewayToken")
                val deviceIdentity = call.argument<String>("deviceIdentity")
                val selectedSimSlot = call.argument<Int>("selectedSimSlot")
                val autoResumeOnBoot = call.argument<Boolean>("autoResumeOnBoot")

                GatewayStorage.configureGateway(
                    context = this,
                    apiBaseUrl = apiBaseUrl,
                    gatewayToken = gatewayToken,
                    deviceIdentity = deviceIdentity,
                    selectedSimSlot = selectedSimSlot,
                    autoResumeOnBoot = autoResumeOnBoot,
                )
                result.success(TelephonyDiagnostics.collectDiagnosticsMap(this))
            }

            "startGatewayService" -> {
                val token = GatewayStorage.getGatewayToken(this)
                if (token.isBlank()) {
                    result.error(
                        "NOT_PAIRED",
                        "Pair this Android handset with your EduSMS account before starting the SIM Gateway service.",
                        null,
                    )
                    return
                }
                GatewayStorage.setServiceState(this, enabled = true, paused = false, running = true)
                EduSmsGatewayService.startServiceIntent(this, EduSmsGatewayService.ACTION_START)
                result.success(TelephonyDiagnostics.collectDiagnosticsMap(this))
            }

            "pauseGatewayService" -> {
                GatewayStorage.setServiceState(this, paused = true)
                if (GatewayStorage.isServiceRunning(this)) {
                    EduSmsGatewayService.startServiceIntent(this, EduSmsGatewayService.ACTION_PAUSE)
                }
                result.success(TelephonyDiagnostics.collectDiagnosticsMap(this))
            }

            "resumeGatewayService" -> {
                val token = GatewayStorage.getGatewayToken(this)
                if (token.isBlank()) {
                    result.error("NOT_PAIRED", "Handset is not paired.", null)
                    return
                }
                GatewayStorage.setServiceState(this, enabled = true, paused = false, running = true)
                EduSmsGatewayService.startServiceIntent(this, EduSmsGatewayService.ACTION_RESUME)
                result.success(TelephonyDiagnostics.collectDiagnosticsMap(this))
            }

            "stopGatewayService" -> {
                GatewayStorage.setServiceState(this, enabled = false, paused = false, running = false)
                val stopIntent = Intent(this, EduSmsGatewayService::class.java).apply {
                    action = EduSmsGatewayService.ACTION_STOP
                }
                startService(stopIntent)
                result.success(TelephonyDiagnostics.collectDiagnosticsMap(this))
            }

            "syncNow" -> {
                val token = GatewayStorage.getGatewayToken(this)
                if (token.isBlank()) {
                    result.error("NOT_PAIRED", "Pair this handset first to sync with the server.", null)
                    return
                }
                if (GatewayStorage.isServiceRunning(this)) {
                    EduSmsGatewayService.startServiceIntent(this, EduSmsGatewayService.ACTION_SYNC_NOW)
                    result.success(TelephonyDiagnostics.collectDiagnosticsMap(this))
                } else {
                    ioExecutor.execute {
                        try {
                            val baseUrl = GatewayStorage.getApiBaseUrl(this)
                            val hb = GatewayHttpClient.sendHeartbeat(
                                baseUrl,
                                token,
                                TelephonyDiagnostics.buildHeartbeatJson(this),
                            )
                            GatewayStorage.recordHeartbeatSuccess(this, hb.optString("server_time", ""))
                            SmsBroadcastReceiver.flushOfflineInboundQueue(this)
                            runOnUiThread {
                                result.success(TelephonyDiagnostics.collectDiagnosticsMap(this))
                            }
                        } catch (exc: Exception) {
                            GatewayStorage.recordError(this, exc.message ?: "Sync failed")
                            runOnUiThread {
                                result.error("SYNC_FAILED", exc.message ?: "Gateway sync failed", null)
                            }
                        }
                    }
                }
            }

            "requestDefaultSmsRole" -> {
                if (TelephonyDiagnostics.isDefaultSmsApp(this)) {
                    result.success(mapOf("is_default_sms_app" to true))
                    return
                }
                if (pendingDefaultSmsRoleResult != null) {
                    result.error("ALREADY_REQUESTING", "Role dialog is already open.", null)
                    return
                }
                try {
                    val roleIntent = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                        val roleManager = getSystemService(RoleManager::class.java)
                        if (roleManager != null && roleManager.isRoleAvailable(RoleManager.ROLE_SMS)) {
                            roleManager.createRequestRoleIntent(RoleManager.ROLE_SMS)
                        } else {
                            null
                        }
                    } else {
                        Intent(Telephony.Sms.Intents.ACTION_CHANGE_DEFAULT).apply {
                            putExtra(Telephony.Sms.Intents.EXTRA_PACKAGE_NAME, packageName)
                        }
                    }
                    if (roleIntent == null) {
                        result.error("ROLE_UNAVAILABLE", "SMS Role is not available on this device.", null)
                        return
                    }
                    pendingDefaultSmsRoleResult = result
                    @Suppress("DEPRECATION")
                    startActivityForResult(roleIntent, REQ_CODE_DEFAULT_SMS_ROLE)
                } catch (exc: Exception) {
                    pendingDefaultSmsRoleResult = null
                    result.error("ROLE_REQUEST_ERROR", exc.message ?: "Failed to open SMS role dialog.", null)
                }
            }

            "clearGatewayCredentials" -> {
                GatewayStorage.clearGatewayCredentials(this)
                stopService(Intent(this, EduSmsGatewayService::class.java))
                result.success(TelephonyDiagnostics.collectDiagnosticsMap(this))
            }

            else -> result.notImplemented()
        }
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray,
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == REQ_CODE_GATEWAY_PERMISSIONS) {
            val cb = pendingPermissionsResult
            pendingPermissionsResult = null
            val updated = TelephonyDiagnostics.checkPermissions(this).toMutableMap()
            for (i in permissions.indices) {
                val permName = permissions[i].substringAfterLast('.')
                val granted = i < grantResults.size && grantResults[i] == PackageManager.PERMISSION_GRANTED
                updated[permName] = granted
            }
            cb?.success(updated)
        }
    }

    @Deprecated("Deprecated in Android Activity, still required for FlutterActivity without ActivityResultRegistry")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == REQ_CODE_DEFAULT_SMS_ROLE) {
            val cb = pendingDefaultSmsRoleResult
            pendingDefaultSmsRoleResult = null
            val granted = resultCode == Activity.RESULT_OK || TelephonyDiagnostics.isDefaultSmsApp(this)
            cb?.success(mapOf("is_default_sms_app" to granted))
        }
    }
}
