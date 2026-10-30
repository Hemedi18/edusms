package com.edusms.edusms_mobile

import android.content.Context
import android.content.SharedPreferences
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

/**
 * Thread-safe SharedPreferences storage for Android SIM Gateway state, offline queues,
 * and idempotent outbound attempt deduplication.
 */
object GatewayStorage {
    private const val PREFS_NAME = "edusms_gateway_prefs"

    private const val KEY_API_BASE_URL = "api_base_url"
    private const val KEY_GATEWAY_TOKEN = "gateway_token"
    private const val KEY_DEVICE_IDENTITY = "device_identity"
    private const val KEY_GATEWAY_ENABLED = "gateway_enabled"
    private const val KEY_GATEWAY_PAUSED = "gateway_paused"
    private const val KEY_AUTO_RESUME_BOOT = "auto_resume_on_boot"
    private const val KEY_SERVICE_RUNNING = "service_running"
    private const val KEY_SELECTED_SIM_SLOT = "selected_sim_slot"
    private const val KEY_LAST_HEARTBEAT_AT = "last_heartbeat_at"
    private const val KEY_LAST_ERROR = "last_error"
    private const val KEY_OFFLINE_INBOUND_QUEUE = "offline_inbound_queue_json"
    private const val KEY_OFFLINE_STATUS_QUEUE = "offline_status_queue_json"
    private const val KEY_TRANSMITTED_ATTEMPTS = "transmitted_attempt_ids"

    private const val MAX_OFFLINE_INBOUND_ITEMS = 250
    private const val MAX_OFFLINE_STATUS_ITEMS = 500
    private const val MAX_TRANSMITTED_ATTEMPT_IDS = 500

    private val lock = Any()

    private fun prefs(context: Context): SharedPreferences =
        context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    fun getApiBaseUrl(context: Context): String = synchronized(lock) {
        (prefs(context).getString(KEY_API_BASE_URL, "http://10.0.2.2:8000") ?: "http://10.0.2.2:8000")
            .trimEnd('/')
    }

    fun getGatewayToken(context: Context): String = synchronized(lock) {
        prefs(context).getString(KEY_GATEWAY_TOKEN, "") ?: ""
    }

    fun getOrCreateDeviceIdentity(context: Context): String = synchronized(lock) {
        val p = prefs(context)
        val existing = p.getString(KEY_DEVICE_IDENTITY, null)
        if (!existing.isNullOrBlank()) {
            return existing
        }
        val created = "and-${UUID.randomUUID()}"
        p.edit().putString(KEY_DEVICE_IDENTITY, created).apply()
        created
    }

    fun isGatewayEnabled(context: Context): Boolean = synchronized(lock) {
        prefs(context).getBoolean(KEY_GATEWAY_ENABLED, false)
    }

    fun isGatewayPaused(context: Context): Boolean = synchronized(lock) {
        prefs(context).getBoolean(KEY_GATEWAY_PAUSED, false)
    }

    fun isAutoResumeOnBoot(context: Context): Boolean = synchronized(lock) {
        prefs(context).getBoolean(KEY_AUTO_RESUME_BOOT, false)
    }

    fun isServiceRunning(context: Context): Boolean = synchronized(lock) {
        prefs(context).getBoolean(KEY_SERVICE_RUNNING, false)
    }

    fun getSelectedSimSlot(context: Context): Int = synchronized(lock) {
        prefs(context).getInt(KEY_SELECTED_SIM_SLOT, 0)
    }

    fun getLastHeartbeatAt(context: Context): String = synchronized(lock) {
        prefs(context).getString(KEY_LAST_HEARTBEAT_AT, "") ?: ""
    }

    fun getLastError(context: Context): String = synchronized(lock) {
        prefs(context).getString(KEY_LAST_ERROR, "") ?: ""
    }

    fun configureGateway(
        context: Context,
        apiBaseUrl: String?,
        gatewayToken: String?,
        deviceIdentity: String?,
        selectedSimSlot: Int?,
        autoResumeOnBoot: Boolean? = null,
    ) = synchronized(lock) {
        val editor = prefs(context).edit()
        if (!apiBaseUrl.isNullOrBlank()) {
            editor.putString(KEY_API_BASE_URL, apiBaseUrl.trim().trimEnd('/'))
        }
        if (gatewayToken != null) {
            editor.putString(KEY_GATEWAY_TOKEN, gatewayToken.trim())
            if (gatewayToken.isNotBlank()) {
                editor.putBoolean(KEY_GATEWAY_ENABLED, true)
            }
        }
        if (!deviceIdentity.isNullOrBlank()) {
            editor.putString(KEY_DEVICE_IDENTITY, deviceIdentity.trim())
        }
        if (selectedSimSlot != null && selectedSimSlot >= 0) {
            editor.putInt(KEY_SELECTED_SIM_SLOT, selectedSimSlot)
        }
        if (autoResumeOnBoot != null) {
            editor.putBoolean(KEY_AUTO_RESUME_BOOT, autoResumeOnBoot)
        }
        editor.apply()
    }

    fun clearGatewayCredentials(context: Context) = synchronized(lock) {
        prefs(context).edit()
            .putString(KEY_GATEWAY_TOKEN, "")
            .putBoolean(KEY_GATEWAY_ENABLED, false)
            .putBoolean(KEY_GATEWAY_PAUSED, false)
            .putBoolean(KEY_SERVICE_RUNNING, false)
            .apply()
    }

    fun setServiceState(
        context: Context,
        enabled: Boolean? = null,
        paused: Boolean? = null,
        running: Boolean? = null,
        selectedSimSlot: Int? = null,
    ) = synchronized(lock) {
        val editor = prefs(context).edit()
        if (enabled != null) editor.putBoolean(KEY_GATEWAY_ENABLED, enabled)
        if (paused != null) editor.putBoolean(KEY_GATEWAY_PAUSED, paused)
        if (running != null) editor.putBoolean(KEY_SERVICE_RUNNING, running)
        if (selectedSimSlot != null && selectedSimSlot >= 0) {
            editor.putInt(KEY_SELECTED_SIM_SLOT, selectedSimSlot)
        }
        editor.apply()
    }

    fun recordHeartbeatSuccess(context: Context, isoTimestamp: String) = synchronized(lock) {
        prefs(context).edit()
            .putString(KEY_LAST_HEARTBEAT_AT, isoTimestamp)
            .putString(KEY_LAST_ERROR, "")
            .apply()
    }

    fun recordError(context: Context, errorMessage: String) = synchronized(lock) {
        prefs(context).edit()
            .putString(KEY_LAST_ERROR, errorMessage.take(250))
            .apply()
    }

    /**
     * Checks whether an outbound job attempt_id has already been handed to SmsManager
     * so network retries or crash recoveries NEVER double-send a carrier SMS.
     */
    fun hasTransmittedAttempt(context: Context, attemptId: String): Boolean = synchronized(lock) {
        if (attemptId.isBlank()) return false
        val raw = prefs(context).getString(KEY_TRANSMITTED_ATTEMPTS, "[]") ?: "[]"
        val arr = runCatching { JSONArray(raw) }.getOrDefault(JSONArray())
        for (i in 0 until arr.length()) {
            if (arr.optString(i) == attemptId) {
                return true
            }
        }
        false
    }

    fun markAttemptTransmitted(context: Context, attemptId: String) = synchronized(lock) {
        if (attemptId.isBlank()) return
        val p = prefs(context)
        val raw = p.getString(KEY_TRANSMITTED_ATTEMPTS, "[]") ?: "[]"
        val existing = runCatching { JSONArray(raw) }.getOrDefault(JSONArray())
        val updated = LinkedHashSet<String>()
        for (i in 0 until existing.length()) {
            val id = existing.optString(i)
            if (id.isNotBlank()) updated.add(id)
        }
        updated.remove(attemptId)
        updated.add(attemptId)

        val list = updated.toList()
        val trimmed = if (list.size > MAX_TRANSMITTED_ATTEMPT_IDS) {
            list.subList(list.size - MAX_TRANSMITTED_ATTEMPT_IDS, list.size)
        } else {
            list
        }
        val out = JSONArray()
        trimmed.forEach { out.put(it) }
        p.edit().putString(KEY_TRANSMITTED_ATTEMPTS, out.toString()).apply()
    }

    fun enqueueOfflineInbound(context: Context, item: JSONObject) = synchronized(lock) {
        val p = prefs(context)
        val raw = p.getString(KEY_OFFLINE_INBOUND_QUEUE, "[]") ?: "[]"
        val arr = runCatching { JSONArray(raw) }.getOrDefault(JSONArray())
        val extId = item.optString("external_message_id")
        val deduped = JSONArray()
        for (i in 0 until arr.length()) {
            val obj = arr.optJSONObject(i) ?: continue
            if (extId.isNotBlank() && obj.optString("external_message_id") == extId) {
                continue
            }
            deduped.put(obj)
        }
        deduped.put(item)
        val trimmed = trimJsonArray(deduped, MAX_OFFLINE_INBOUND_ITEMS)
        p.edit().putString(KEY_OFFLINE_INBOUND_QUEUE, trimmed.toString()).apply()
    }

    fun peekOfflineInbound(context: Context): List<JSONObject> = synchronized(lock) {
        val raw = prefs(context).getString(KEY_OFFLINE_INBOUND_QUEUE, "[]") ?: "[]"
        val arr = runCatching { JSONArray(raw) }.getOrDefault(JSONArray())
        val out = ArrayList<JSONObject>(arr.length())
        for (i in 0 until arr.length()) {
            arr.optJSONObject(i)?.let { out.add(it) }
        }
        out
    }

    fun removeOfflineInboundByExternalIds(context: Context, syncedIds: Set<String>) = synchronized(lock) {
        if (syncedIds.isEmpty()) return
        val p = prefs(context)
        val raw = p.getString(KEY_OFFLINE_INBOUND_QUEUE, "[]") ?: "[]"
        val arr = runCatching { JSONArray(raw) }.getOrDefault(JSONArray())
        val remaining = JSONArray()
        for (i in 0 until arr.length()) {
            val obj = arr.optJSONObject(i) ?: continue
            if (obj.optString("external_message_id") !in syncedIds) {
                remaining.put(obj)
            }
        }
        p.edit().putString(KEY_OFFLINE_INBOUND_QUEUE, remaining.toString()).apply()
    }

    fun getOfflineInboundCount(context: Context): Int = synchronized(lock) {
        val raw = prefs(context).getString(KEY_OFFLINE_INBOUND_QUEUE, "[]") ?: "[]"
        runCatching { JSONArray(raw).length() }.getOrDefault(0)
    }

    fun enqueueOfflineStatus(context: Context, item: JSONObject) = synchronized(lock) {
        val p = prefs(context)
        val raw = p.getString(KEY_OFFLINE_STATUS_QUEUE, "[]") ?: "[]"
        val arr = runCatching { JSONArray(raw) }.getOrDefault(JSONArray())
        arr.put(item)
        val trimmed = trimJsonArray(arr, MAX_OFFLINE_STATUS_ITEMS)
        p.edit().putString(KEY_OFFLINE_STATUS_QUEUE, trimmed.toString()).apply()
    }

    fun drainOfflineStatusQueue(context: Context): List<JSONObject> = synchronized(lock) {
        val p = prefs(context)
        val raw = p.getString(KEY_OFFLINE_STATUS_QUEUE, "[]") ?: "[]"
        val arr = runCatching { JSONArray(raw) }.getOrDefault(JSONArray())
        val out = ArrayList<JSONObject>(arr.length())
        for (i in 0 until arr.length()) {
            arr.optJSONObject(i)?.let { out.add(it) }
        }
        p.edit().putString(KEY_OFFLINE_STATUS_QUEUE, "[]").apply()
        out
    }

    fun getOfflineStatusCount(context: Context): Int = synchronized(lock) {
        val raw = prefs(context).getString(KEY_OFFLINE_STATUS_QUEUE, "[]") ?: "[]"
        runCatching { JSONArray(raw).length() }.getOrDefault(0)
    }

    private fun trimJsonArray(source: JSONArray, maxItems: Int): JSONArray {
        if (source.length() <= maxItems) return source
        val trimmed = JSONArray()
        val start = source.length() - maxItems
        for (i in start until source.length()) {
            trimmed.put(source.get(i))
        }
        return trimmed
    }
}
