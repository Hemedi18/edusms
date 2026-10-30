package com.edusms.edusms_mobile

import android.app.Activity
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.provider.Telephony
import android.telephony.SmsManager
import android.telephony.SmsMessage
import org.json.JSONObject
import java.util.concurrent.Executors

/**
 * Receives authentic Android SmsManager SENT & carrier DELIVERED callbacks.
 * Strictly distinguishes radio acceptance (RESULT_OK -> "sent" -> backend "submitted")
 * from carrier delivery confirmation PDU ("delivered").
 */
class SmsStatusReceiver : BroadcastReceiver() {

    companion object {
        private val callbackExecutor = Executors.newSingleThreadExecutor()

        fun dispatchOrQueueCallback(context: Context, callbackPayload: JSONObject) {
            val appCtx = context.applicationContext
            callbackExecutor.execute {
                val baseUrl = GatewayStorage.getApiBaseUrl(appCtx)
                val token = GatewayStorage.getGatewayToken(appCtx)
                if (token.isBlank()) {
                    GatewayStorage.enqueueOfflineStatus(appCtx, callbackPayload)
                    return@execute
                }
                try {
                    GatewayHttpClient.postStatusCallback(baseUrl, token, callbackPayload)
                } catch (exc: Exception) {
                    GatewayStorage.recordError(appCtx, exc.message ?: "Offline status callback queued")
                    GatewayStorage.enqueueOfflineStatus(appCtx, callbackPayload)
                }
            }
        }
    }

    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action ?: return
        val attemptId = intent.getStringExtra("attempt_id") ?: ""
        val messageId = intent.getStringExtra("message_id") ?: ""
        val recipient = intent.getStringExtra("recipient_number") ?: ""
        val partIndex = intent.getIntExtra("part_index", 0)
        val totalParts = intent.getIntExtra("total_parts", 1).coerceAtLeast(1)

        if (attemptId.isBlank() && messageId.isBlank()) return

        when (action) {
            SmsTransmitter.ACTION_SMS_SENT -> {
                handleSentCallback(
                    context = context,
                    resultCode = resultCode,
                    intent = intent,
                    attemptId = attemptId,
                    messageId = messageId,
                    recipient = recipient,
                    partIndex = partIndex,
                    totalParts = totalParts,
                )
            }
            SmsTransmitter.ACTION_SMS_DELIVERED -> {
                handleDeliveredCallback(
                    context = context,
                    resultCode = resultCode,
                    intent = intent,
                    attemptId = attemptId,
                    messageId = messageId,
                    recipient = recipient,
                    partIndex = partIndex,
                    totalParts = totalParts,
                )
            }
        }
    }

    private fun handleSentCallback(
        context: Context,
        resultCode: Int,
        intent: Intent,
        attemptId: String,
        messageId: String,
        recipient: String,
        partIndex: Int,
        totalParts: Int,
    ) {
        if (resultCode == Activity.RESULT_OK) {
            // For multi-part SMS, wait until the final segment is accepted by radio before marking submitted
            if (partIndex < totalParts - 1) {
                return
            }
            val detail = "Android SmsManager accepted SMS ($totalParts part(s)) for radio transmission; awaiting carrier DLR."
            val payload = JSONObject().apply {
                put("attempt_id", attemptId)
                put("message_id", messageId)
                put("event", "sent")
                put("event_type", "sent")
                put("result_code", "RESULT_OK")
                put("android_result_code", "RESULT_OK")
                put("detail", detail)
            }
            GatewayEventBus.emit(
                "sms.sent_callback",
                mapOf(
                    "attempt_id" to attemptId,
                    "message_id" to messageId,
                    "recipient_number" to recipient,
                    "event_type" to "sent",
                    "result_code" to "RESULT_OK",
                    "detail" to detail,
                ),
            )
            dispatchOrQueueCallback(context, payload)
        } else {
            val (codeLabel, humanDetail) = describeSendFailure(resultCode, intent)
            val payload = JSONObject().apply {
                put("attempt_id", attemptId)
                put("message_id", messageId)
                put("event", "failed")
                put("event_type", "failed")
                put("result_code", codeLabel)
                put("android_result_code", codeLabel)
                put("detail", humanDetail)
            }
            GatewayEventBus.emit(
                "sms.sent_callback",
                mapOf(
                    "attempt_id" to attemptId,
                    "message_id" to messageId,
                    "recipient_number" to recipient,
                    "event_type" to "failed",
                    "result_code" to codeLabel,
                    "detail" to humanDetail,
                ),
            )
            dispatchOrQueueCallback(context, payload)
        }
    }

    private fun handleDeliveredCallback(
        context: Context,
        resultCode: Int,
        intent: Intent,
        attemptId: String,
        messageId: String,
        recipient: String,
        partIndex: Int,
        totalParts: Int,
    ) {
        val pdu = intent.getByteArrayExtra("pdu")
        val format = intent.getStringExtra("format")

        var pduStatus: Int? = null
        if (pdu != null && pdu.isNotEmpty()) {
            pduStatus = runCatching {
                val sms = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !format.isNullOrBlank()) {
                    SmsMessage.createFromPdu(pdu, format)
                } else {
                    @Suppress("DEPRECATION")
                    SmsMessage.createFromPdu(pdu)
                }
                sms?.status
            }.getOrNull()
        }

        val (eventType, statusCode, detail) = when {
            pduStatus != null && pduStatus == Telephony.Sms.STATUS_COMPLETE -> {
                if (partIndex < totalParts - 1) return
                Triple(
                    "delivered",
                    "STATUS_COMPLETE_0",
                    "Carrier delivery report PDU confirmed delivery to recipient handset.",
                )
            }
            pduStatus != null && pduStatus >= Telephony.Sms.STATUS_FAILED -> {
                Triple(
                    "delivery_failed",
                    "PDU_STATUS_$pduStatus",
                    "Carrier delivery report PDU indicated permanent delivery failure (status=$pduStatus).",
                )
            }
            pduStatus != null && pduStatus >= Telephony.Sms.STATUS_PENDING -> {
                Triple(
                    "delivery_unknown",
                    "PDU_PENDING_$pduStatus",
                    "Carrier reported pending/intermediate delivery state (status=$pduStatus).",
                )
            }
            resultCode == Activity.RESULT_OK -> {
                if (partIndex < totalParts - 1) return
                Triple(
                    "delivered",
                    "RESULT_OK_NO_PDU",
                    "Android delivery broadcast reported RESULT_OK.",
                )
            }
            else -> {
                Triple(
                    "delivery_failed",
                    "DELIVERY_RESULT_$resultCode",
                    "Carrier delivery broadcast returned failure code $resultCode.",
                )
            }
        }

        val payload = JSONObject().apply {
            put("attempt_id", attemptId)
            put("message_id", messageId)
            put("event", eventType)
            put("event_type", eventType)
            put("result_code", statusCode)
            put("android_result_code", statusCode)
            put("detail", detail)
        }
        GatewayEventBus.emit(
            "sms.delivered_callback",
            mapOf(
                "attempt_id" to attemptId,
                "message_id" to messageId,
                "recipient_number" to recipient,
                "event_type" to eventType,
                "result_code" to statusCode,
                "detail" to detail,
            ),
        )
        dispatchOrQueueCallback(context, payload)
    }

    private fun describeSendFailure(resultCode: Int, intent: Intent): Pair<String, String> {
        val radioErrorCode = intent.getIntExtra("errorCode", -1)
        val suffix = if (radioErrorCode >= 0) " (modem errorCode=$radioErrorCode)" else ""
        return when (resultCode) {
            SmsManager.RESULT_ERROR_GENERIC_FAILURE ->
                "RESULT_ERROR_GENERIC_FAILURE" to "Generic carrier/modem SMS transmission failure$suffix. Verify SIM balance and signal."
            SmsManager.RESULT_ERROR_NO_SERVICE ->
                "RESULT_ERROR_NO_SERVICE" to "No cellular service available on selected SIM$suffix."
            SmsManager.RESULT_ERROR_NULL_PDU ->
                "RESULT_ERROR_NULL_PDU" to "Modem rejected malformed/null SMS PDU$suffix."
            SmsManager.RESULT_ERROR_RADIO_OFF ->
                "RESULT_ERROR_RADIO_OFF" to "Cellular radio is off (Airplane Mode enabled)$suffix."
            SmsManager.RESULT_ERROR_LIMIT_EXCEEDED ->
                "RESULT_ERROR_LIMIT_EXCEEDED" to "Android OS outgoing SMS rate limit exceeded$suffix."
            SmsManager.RESULT_ERROR_SHORT_CODE_NOT_ALLOWED ->
                "RESULT_ERROR_SHORT_CODE_NOT_ALLOWED" to "Short-code SMS transmission blocked by Android settings$suffix."
            else ->
                "SMS_RESULT_$resultCode" to "Android SmsManager failed with result code $resultCode$suffix."
        }
    }
}
