package com.edusms.edusms_mobile

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.provider.Telephony
import org.json.JSONArray
import org.json.JSONObject
import java.security.MessageDigest
import java.util.concurrent.Executors

/**
 * Captures incoming carrier SMS broadcasts when the user has explicitly paired and enabled
 * the EduSMS SIM Gateway, concatenates multi-part SMS segments, computes deterministic
 * SHA-256 deduplication IDs, persists to an offline-safe queue, and synchronizes to Django.
 */
class SmsBroadcastReceiver : BroadcastReceiver() {

    companion object {
        private val inboundExecutor = Executors.newSingleThreadExecutor()

        fun sha256Hex(input: String): String {
            val digest = MessageDigest.getInstance("SHA-256")
            val bytes = digest.digest(input.toByteArray(Charsets.UTF_8))
            val sb = StringBuilder(bytes.size * 2)
            for (b in bytes) {
                sb.append(String.format("%02x", b))
            }
            return sb.toString()
        }

        fun flushOfflineInboundQueue(context: Context): Int {
            val appCtx = context.applicationContext
            val token = GatewayStorage.getGatewayToken(appCtx)
            if (token.isBlank() || !GatewayStorage.isGatewayEnabled(appCtx)) {
                return 0
            }
            val queued = GatewayStorage.peekOfflineInbound(appCtx)
            if (queued.isEmpty()) return 0

            val batch = queued.take(50)
            val batchArray = JSONArray()
            val batchIds = HashSet<String>()
            for (obj in batch) {
                batchArray.put(obj)
                val id = obj.optString("external_message_id")
                if (id.isNotBlank()) batchIds.add(id)
            }

            val baseUrl = GatewayStorage.getApiBaseUrl(appCtx)
            GatewayHttpClient.syncInboundMessages(baseUrl, token, batchArray)
            GatewayStorage.removeOfflineInboundByExternalIds(appCtx, batchIds)
            return batch.size
        }
    }

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Telephony.Sms.Intents.SMS_RECEIVED_ACTION) return
        val appCtx = context.applicationContext

        // Never capture SMS covertly: only process when gateway is explicitly paired and enabled
        if (!GatewayStorage.isGatewayEnabled(appCtx) || GatewayStorage.getGatewayToken(appCtx).isBlank()) {
            return
        }

        val parts = Telephony.Sms.Intents.getMessagesFromIntent(intent)
        if (parts.isNullOrEmpty()) return

        // Concatenate multi-part SMS segments grouped by originating sender address
        data class AggregatedSms(
            val sender: String,
            val bodyBuilder: StringBuilder = StringBuilder(),
            var timestampMillis: Long = System.currentTimeMillis(),
        )

        val grouped = LinkedHashMap<String, AggregatedSms>()
        for (sms in parts) {
            val sender = sms?.originatingAddress?.trim().orEmpty()
            if (sender.isEmpty()) continue
            val entry = grouped.getOrPut(sender) {
                AggregatedSms(
                    sender = sender,
                    timestampMillis = sms.timestampMillis.takeIf { it > 0 } ?: System.currentTimeMillis(),
                )
            }
            entry.bodyBuilder.append(sms.messageBody ?: "")
        }
        if (grouped.isEmpty()) return

        val slotIndex = extractSimSlot(intent)
        val deviceIdentity = GatewayStorage.getOrCreateDeviceIdentity(appCtx)

        for ((_, agg) in grouped) {
            val fullBody = agg.bodyBuilder.toString()
            val externalId = sha256Hex("$deviceIdentity|${agg.sender}|${agg.timestampMillis}|$fullBody")
            val itemJson = JSONObject().apply {
                put("sender", agg.sender)
                put("sender_number", agg.sender)
                put("body", fullBody)
                put("text", fullBody)
                put("external_message_id", externalId)
                put("timestamp_millis", agg.timestampMillis)
                if (slotIndex != null && slotIndex >= 0) {
                    put("sim_slot", slotIndex)
                }
            }
            // Persist first so zero inbound messages are lost if network drops mid-flight
            GatewayStorage.enqueueOfflineInbound(appCtx, itemJson)

            GatewayEventBus.emit(
                "sms.inbound_received",
                mapOf(
                    "external_message_id" to externalId,
                    "sender" to agg.sender,
                    "body" to fullBody,
                    "sim_slot" to slotIndex,
                    "timestamp_millis" to agg.timestampMillis,
                ),
            )
        }

        val pendingResult = goAsync()
        inboundExecutor.execute {
            try {
                flushOfflineInboundQueue(appCtx)
            } catch (exc: Exception) {
                GatewayStorage.recordError(appCtx, exc.message ?: "Inbound SMS queued offline")
            } finally {
                pendingResult.finish()
            }
        }
    }

    private fun extractSimSlot(intent: Intent): Int? {
        val extras = intent.extras ?: return null
        val slotKeys = listOf(
            "android.telephony.extra.SLOT_INDEX",
            "slot",
            "simSlot",
            "phone",
        )
        for (key in slotKeys) {
            if (extras.containsKey(key)) {
                val value = extras.getInt(key, -1)
                if (value >= 0) return value
            }
        }
        return null
    }
}
