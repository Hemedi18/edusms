package com.edusms.edusms_mobile

import android.Manifest
import android.app.role.RoleManager
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.os.BatteryManager
import android.os.Build
import android.provider.Telephony
import android.telephony.SubscriptionManager
import android.telephony.TelephonyManager
import org.json.JSONArray
import org.json.JSONObject

/**
 * Inspects Android runtime permissions, active multi-SIM subscriptions, radio network type,
 * battery telemetry, and Default SMS Role status safely across Android API levels.
 */
object TelephonyDiagnostics {

    fun checkPermissions(context: Context): Map<String, Boolean> {
        val sendSms = hasPermission(context, Manifest.permission.SEND_SMS)
        val receiveSms = hasPermission(context, Manifest.permission.RECEIVE_SMS)
        val readSms = hasPermission(context, Manifest.permission.READ_SMS)
        val readPhoneState = hasPermission(context, Manifest.permission.READ_PHONE_STATE)
        val postNotifications = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            hasPermission(context, Manifest.permission.POST_NOTIFICATIONS)
        } else {
            true
        }
        return linkedMapOf(
            "SEND_SMS" to sendSms,
            "RECEIVE_SMS" to receiveSms,
            "READ_SMS" to readSms,
            "READ_PHONE_STATE" to readPhoneState,
            "POST_NOTIFICATIONS" to postNotifications,
        )
    }

    fun hasPermission(context: Context, permission: String): Boolean {
        return context.checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED
    }

    fun getSimSlots(context: Context): List<Map<String, Any?>> {
        if (!hasPermission(context, Manifest.permission.READ_PHONE_STATE)) {
            return emptyList()
        }
        return try {
            val subManager = context.getSystemService(Context.TELEPHONY_SUBSCRIPTION_SERVICE) as? SubscriptionManager
                ?: return emptyList()
            val activeList = subManager.activeSubscriptionInfoList ?: emptyList()
            activeList.map { info ->
                @Suppress("DEPRECATION")
                val rawNumber = runCatching {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                        subManager.getPhoneNumber(info.subscriptionId)
                    } else {
                        info.number ?: ""
                    }
                }.getOrDefault("") ?: ""

                linkedMapOf<String, Any?>(
                    "slot_index" to info.simSlotIndex,
                    "subscription_id" to info.subscriptionId,
                    "carrier_name" to (info.carrierName?.toString() ?: ""),
                    "display_name" to (info.displayName?.toString() ?: "SIM ${info.simSlotIndex + 1}"),
                    "country_iso" to (info.countryIso ?: ""),
                    "number_hint" to rawNumber,
                    "phone_number" to rawNumber,
                )
            }
        } catch (_: SecurityException) {
            emptyList()
        } catch (_: Exception) {
            emptyList()
        }
    }

    fun resolveSubscriptionIdForSlot(context: Context, slotIndex: Int): Int? {
        val slots = getSimSlots(context)
        val match = slots.firstOrNull { (it["slot_index"] as? Int) == slotIndex }
            ?: slots.firstOrNull()
        return match?.get("subscription_id") as? Int
    }

    fun isDefaultSmsApp(context: Context): Boolean {
        return try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                val roleManager = context.getSystemService(RoleManager::class.java)
                if (roleManager != null && roleManager.isRoleAvailable(RoleManager.ROLE_SMS)) {
                    return roleManager.isRoleHeld(RoleManager.ROLE_SMS)
                }
            }
            Telephony.Sms.getDefaultSmsPackage(context) == context.packageName
        } catch (_: Exception) {
            false
        }
    }

    fun getBatteryInfo(context: Context): Pair<Int?, Boolean> {
        return try {
            val bm = context.getSystemService(Context.BATTERY_SERVICE) as? BatteryManager
            val sticky = context.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
            val level = bm?.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)
                ?.takeIf { it in 0..100 }
                ?: sticky?.let {
                    val lvl = it.getIntExtra(BatteryManager.EXTRA_LEVEL, -1)
                    val scale = it.getIntExtra(BatteryManager.EXTRA_SCALE, -1)
                    if (lvl >= 0 && scale > 0) (lvl * 100) / scale else null
                }
            val status = sticky?.getIntExtra(BatteryManager.EXTRA_STATUS, -1) ?: -1
            val isCharging = status == BatteryManager.BATTERY_STATUS_CHARGING ||
                status == BatteryManager.BATTERY_STATUS_FULL
            Pair(level, isCharging)
        } catch (_: Exception) {
            Pair(null, false)
        }
    }

    fun getNetworkMetadata(context: Context): Pair<String, String> {
        val tm = context.getSystemService(Context.TELEPHONY_SERVICE) as? TelephonyManager
            ?: return Pair("UNKNOWN", "")
        val carrier = runCatching { tm.networkOperatorName ?: "" }.getOrDefault("")
        val networkType = try {
            if (hasPermission(context, Manifest.permission.READ_PHONE_STATE)) {
                @Suppress("DEPRECATION")
                val typeInt = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                    tm.dataNetworkType
                } else {
                    tm.networkType
                }
                mapNetworkType(typeInt)
            } else {
                "CELLULAR"
            }
        } catch (_: SecurityException) {
            "CELLULAR"
        } catch (_: Exception) {
            "UNKNOWN"
        }
        return Pair(networkType, carrier)
    }

    private fun mapNetworkType(type: Int): String = when (type) {
        TelephonyManager.NETWORK_TYPE_NR -> "5G NR"
        TelephonyManager.NETWORK_TYPE_LTE -> "4G LTE"
        TelephonyManager.NETWORK_TYPE_HSPAP,
        TelephonyManager.NETWORK_TYPE_HSPA,
        TelephonyManager.NETWORK_TYPE_HSDPA,
        TelephonyManager.NETWORK_TYPE_HSUPA,
        TelephonyManager.NETWORK_TYPE_UMTS -> "3G HSPA"
        TelephonyManager.NETWORK_TYPE_EDGE,
        TelephonyManager.NETWORK_TYPE_GPRS,
        TelephonyManager.NETWORK_TYPE_GSM -> "2G GSM"
        else -> "CELLULAR"
    }

    fun collectDiagnosticsMap(context: Context): Map<String, Any?> {
        val permissions = checkPermissions(context)
        val simSlots = getSimSlots(context)
        val (batteryLevel, isCharging) = getBatteryInfo(context)
        val (networkType, carrierName) = getNetworkMetadata(context)
        val tm = context.getSystemService(Context.TELEPHONY_SERVICE) as? TelephonyManager
        val simReady = runCatching { tm?.simState == TelephonyManager.SIM_STATE_READY }.getOrDefault(false)
        val simAvailable = simSlots.isNotEmpty() || simReady

        val resolvedCarrier = carrierName.ifBlank {
            (simSlots.firstOrNull()?.get("carrier_name") as? String) ?: ""
        }

        return linkedMapOf(
            "platform" to "android",
            "supports_physical_sim_gateway" to true,
            "manufacturer" to (Build.MANUFACTURER ?: "Android"),
            "device_model" to (Build.MODEL ?: "Handset"),
            "os_version" to "Android ${Build.VERSION.RELEASE ?: Build.VERSION.SDK_INT}",
            "sdk_int" to Build.VERSION.SDK_INT,
            "device_identity" to GatewayStorage.getOrCreateDeviceIdentity(context),
            "permissions_state" to permissions,
            "sim_available" to simAvailable,
            "sim_slots" to simSlots,
            "selected_sim_slot" to GatewayStorage.getSelectedSimSlot(context),
            "network_type" to networkType,
            "carrier_name" to resolvedCarrier,
            "battery_level" to batteryLevel,
            "is_charging" to isCharging,
            "is_default_sms_app" to isDefaultSmsApp(context),
            "gateway_configured" to GatewayStorage.getGatewayToken(context).isNotBlank(),
            "gateway_enabled" to GatewayStorage.isGatewayEnabled(context),
            "gateway_paused" to GatewayStorage.isGatewayPaused(context),
            "service_running" to GatewayStorage.isServiceRunning(context),
            "auto_resume_on_boot" to GatewayStorage.isAutoResumeOnBoot(context),
            "offline_inbound_queue_count" to GatewayStorage.getOfflineInboundCount(context),
            "offline_status_queue_count" to GatewayStorage.getOfflineStatusCount(context),
            "last_heartbeat_at" to GatewayStorage.getLastHeartbeatAt(context),
            "last_error" to GatewayStorage.getLastError(context),
        )
    }

    fun buildHeartbeatJson(context: Context): JSONObject {
        val map = collectDiagnosticsMap(context)
        val permsJson = JSONObject()
        @Suppress("UNCHECKED_CAST")
        (map["permissions_state"] as? Map<String, Boolean>)?.forEach { (k, v) ->
            permsJson.put(k, v)
        }

        val slotsJson = JSONArray()
        @Suppress("UNCHECKED_CAST")
        (map["sim_slots"] as? List<Map<String, Any?>>)?.forEach { slot ->
            val obj = JSONObject()
            slot.forEach { (k, v) -> obj.put(k, v) }
            slotsJson.put(obj)
        }

        return JSONObject().apply {
            put("sim_available", map["sim_available"] == true)
            put("sim_slots", slotsJson)
            put("network_type", map["network_type"] ?: "")
            put("carrier_name", map["carrier_name"] ?: "")
            if (map["battery_level"] != null) {
                put("battery_level", map["battery_level"])
            }
            put("is_charging", map["is_charging"] == true)
            put("is_default_sms_app", map["is_default_sms_app"] == true)
            put("permissions_state", permsJson)
            put("last_error", map["last_error"] ?: "")
        }
    }
}
