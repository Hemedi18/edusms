package com.edusms.edusms_mobile

import android.Manifest
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import android.telephony.SmsManager

data class TransmitOutcome(
    val dispatched: Boolean,
    val deduplicated: Boolean,
    val errorCode: String = "",
    val detail: String = "",
    val partsCount: Int = 0,
)

/**
 * Transmits outbound SMS messages over physical cellular SIM radio via Android SmsManager
 * with strict attempt_id idempotency and multi-SIM subscription selection.
 */
object SmsTransmitter {
    const val ACTION_SMS_SENT = "com.edusms.edusms_mobile.SMS_SENT"
    const val ACTION_SMS_DELIVERED = "com.edusms.edusms_mobile.SMS_DELIVERED"

    fun transmit(
        context: Context,
        attemptId: String,
        messageId: String,
        destinationNumber: String,
        body: String,
        simSlot: Int?,
    ): TransmitOutcome {
        val trimmedDest = destinationNumber.trim()
        if (trimmedDest.isEmpty()) {
            return TransmitOutcome(
                dispatched = false,
                deduplicated = false,
                errorCode = "INVALID_DESTINATION",
                detail = "Destination phone number is empty.",
            )
        }
        if (body.isEmpty()) {
            return TransmitOutcome(
                dispatched = false,
                deduplicated = false,
                errorCode = "EMPTY_BODY",
                detail = "SMS message body cannot be empty.",
            )
        }
        if (!TelephonyDiagnostics.hasPermission(context, Manifest.permission.SEND_SMS)) {
            return TransmitOutcome(
                dispatched = false,
                deduplicated = false,
                errorCode = "PERMISSION_SEND_SMS_DENIED",
                detail = "SEND_SMS runtime permission is not granted on this Android device.",
            )
        }

        // Strict idempotency guard: never transmit the same attempt_id over cellular radio twice!
        if (GatewayStorage.hasTransmittedAttempt(context, attemptId)) {
            return TransmitOutcome(
                dispatched = false,
                deduplicated = true,
                detail = "Skipped duplicate radio send for already-transmitted attempt $attemptId.",
            )
        }

        return try {
            val targetSlot = simSlot ?: GatewayStorage.getSelectedSimSlot(context)
            val smsManager = resolveSmsManager(context, targetSlot)
            val parts = smsManager.divideMessage(body)
            val totalParts = parts.size.coerceAtLeast(1)

            // Mark attempt transmitted right before radio dispatch so retries cannot duplicate
            GatewayStorage.markAttemptTransmitted(context, attemptId)

            if (parts.size <= 1) {
                val sentPi = buildStatusPendingIntent(
                    context = context,
                    action = ACTION_SMS_SENT,
                    attemptId = attemptId,
                    messageId = messageId,
                    recipient = trimmedDest,
                    partIndex = 0,
                    totalParts = 1,
                )
                val deliveredPi = buildStatusPendingIntent(
                    context = context,
                    action = ACTION_SMS_DELIVERED,
                    attemptId = attemptId,
                    messageId = messageId,
                    recipient = trimmedDest,
                    partIndex = 0,
                    totalParts = 1,
                )
                smsManager.sendTextMessage(trimmedDest, null, body, sentPi, deliveredPi)
            } else {
                val sentIntents = ArrayList<PendingIntent>(parts.size)
                val deliveredIntents = ArrayList<PendingIntent>(parts.size)
                for (idx in parts.indices) {
                    sentIntents.add(
                        buildStatusPendingIntent(
                            context = context,
                            action = ACTION_SMS_SENT,
                            attemptId = attemptId,
                            messageId = messageId,
                            recipient = trimmedDest,
                            partIndex = idx,
                            totalParts = totalParts,
                        )
                    )
                    deliveredIntents.add(
                        buildStatusPendingIntent(
                            context = context,
                            action = ACTION_SMS_DELIVERED,
                            attemptId = attemptId,
                            messageId = messageId,
                            recipient = trimmedDest,
                            partIndex = idx,
                            totalParts = totalParts,
                        )
                    )
                }
                smsManager.sendMultipartTextMessage(
                    trimmedDest,
                    null,
                    parts,
                    sentIntents,
                    deliveredIntents,
                )
            }

            GatewayEventBus.emit(
                "sms.dispatched_to_radio",
                mapOf(
                    "attempt_id" to attemptId,
                    "message_id" to messageId,
                    "recipient_number" to trimmedDest,
                    "sim_slot" to targetSlot,
                    "parts_count" to totalParts,
                ),
            )

            TransmitOutcome(
                dispatched = true,
                deduplicated = false,
                detail = "Dispatched $totalParts SMS PDU part(s) to Android SmsManager.",
                partsCount = totalParts,
            )
        } catch (sec: SecurityException) {
            TransmitOutcome(
                dispatched = false,
                deduplicated = false,
                errorCode = "SECURITY_EXCEPTION",
                detail = sec.message ?: "Android blocked SMS radio access.",
            )
        } catch (exc: Exception) {
            TransmitOutcome(
                dispatched = false,
                deduplicated = false,
                errorCode = "SMS_MANAGER_EXCEPTION",
                detail = exc.message ?: "Unexpected SmsManager exception.",
            )
        }
    }

    private fun resolveSmsManager(context: Context, simSlot: Int): SmsManager {
        val subscriptionId = TelephonyDiagnostics.resolveSubscriptionIdForSlot(context, simSlot)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            val baseManager = context.getSystemService(SmsManager::class.java)
            if (baseManager != null) {
                return if (subscriptionId != null && subscriptionId >= 0) {
                    baseManager.createForSubscriptionId(subscriptionId)
                } else {
                    baseManager
                }
            }
        }
        @Suppress("DEPRECATION")
        return if (subscriptionId != null && subscriptionId >= 0) {
            SmsManager.getSmsManagerForSubscriptionId(subscriptionId)
        } else {
            SmsManager.getDefault()
        }
    }

    private fun buildStatusPendingIntent(
        context: Context,
        action: String,
        attemptId: String,
        messageId: String,
        recipient: String,
        partIndex: Int,
        totalParts: Int,
    ): PendingIntent {
        val intent = Intent(context, SmsStatusReceiver::class.java).apply {
            this.action = action
            setPackage(context.packageName)
            putExtra("attempt_id", attemptId)
            putExtra("message_id", messageId)
            putExtra("recipient_number", recipient)
            putExtra("part_index", partIndex)
            putExtra("total_parts", totalParts)
        }
        val reqCode = "$action|$attemptId|$partIndex".hashCode()
        val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        return PendingIntent.getBroadcast(context, reqCode, intent, flags)
    }
}
