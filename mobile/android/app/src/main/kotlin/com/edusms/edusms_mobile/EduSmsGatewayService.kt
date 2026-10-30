package com.edusms.edusms_mobile

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import org.json.JSONObject
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.TimeUnit

/**
 * User-visible Foreground Android Service for EduSMS SIM Gateway synchronization.
 * Always displays a clear, persistent notification with Pause/Resume and Stop actions.
 */
class EduSmsGatewayService : Service() {

    companion object {
        const val CHANNEL_ID = "edusms_gateway_foreground_channel"
        const val NOTIFICATION_ID = 4201

        const val ACTION_START = "com.edusms.edusms_mobile.ACTION_START_GATEWAY"
        const val ACTION_PAUSE = "com.edusms.edusms_mobile.ACTION_PAUSE_GATEWAY"
        const val ACTION_RESUME = "com.edusms.edusms_mobile.ACTION_RESUME_GATEWAY"
        const val ACTION_STOP = "com.edusms.edusms_mobile.ACTION_STOP_GATEWAY"
        const val ACTION_SYNC_NOW = "com.edusms.edusms_mobile.ACTION_SYNC_NOW"

        private const val POLL_INTERVAL_SECONDS = 15L

        fun startServiceIntent(context: Context, action: String = ACTION_START) {
            val intent = Intent(context, EduSmsGatewayService::class.java).apply {
                this.action = action
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
        }
    }

    private var scheduler: ScheduledExecutorService? = null

    @Volatile
    private var syncInFlight = false

    override fun onCreate() {
        super.onCreate()
        ensureNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> {
                GatewayStorage.setServiceState(this, enabled = false, paused = false, running = false)
                GatewayEventBus.emit("gateway.service_state", TelephonyDiagnostics.collectDiagnosticsMap(this))
                stopForegroundCompat()
                stopSelf()
                return START_NOT_STICKY
            }
            ACTION_PAUSE -> {
                GatewayStorage.setServiceState(this, paused = true, running = true)
                promoteToForeground("EduSMS SIM Gateway Paused — Outbound job polling paused by user")
                triggerImmediateSync()
                return START_STICKY
            }
            ACTION_RESUME -> {
                GatewayStorage.setServiceState(this, enabled = true, paused = false, running = true)
                promoteToForeground("EduSMS SIM Gateway Active — Connected & monitoring authorized SMS jobs")
                ensureSchedulerStarted()
                triggerImmediateSync()
                return START_STICKY
            }
            ACTION_SYNC_NOW -> {
                if (GatewayStorage.isServiceRunning(this)) {
                    promoteToForeground(currentStatusNotificationText())
                }
                triggerImmediateSync()
                return START_STICKY
            }
            else -> {
                GatewayStorage.setServiceState(this, enabled = true, running = true)
                promoteToForeground(currentStatusNotificationText())
                ensureSchedulerStarted()
                triggerImmediateSync()
                return START_STICKY
            }
        }
    }

    override fun onDestroy() {
        scheduler?.shutdownNow()
        scheduler = null
        GatewayStorage.setServiceState(this, running = false)
        GatewayEventBus.emit("gateway.service_state", TelephonyDiagnostics.collectDiagnosticsMap(this))
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun ensureSchedulerStarted() {
        if (scheduler != null && !scheduler!!.isShutdown) return
        scheduler = Executors.newSingleThreadScheduledExecutor().also { exec ->
            exec.scheduleWithFixedDelay(
                { runSyncCycle() },
                POLL_INTERVAL_SECONDS,
                POLL_INTERVAL_SECONDS,
                TimeUnit.SECONDS,
            )
        }
    }

    private fun triggerImmediateSync() {
        val exec = scheduler
        if (exec != null && !exec.isShutdown) {
            exec.execute { runSyncCycle() }
        } else {
            Executors.newSingleThreadExecutor().execute { runSyncCycle() }
        }
    }

    private fun runSyncCycle() {
        if (syncInFlight) return
        val token = GatewayStorage.getGatewayToken(this)
        if (token.isBlank()) {
            GatewayStorage.recordError(this, "Pair this handset first to activate gateway sync.")
            GatewayEventBus.emit("gateway.service_state", TelephonyDiagnostics.collectDiagnosticsMap(this))
            return
        }

        syncInFlight = true
        try {
            val baseUrl = GatewayStorage.getApiBaseUrl(this)

            // 1. Heartbeat + Telemetry Sync
            val telemetry = TelephonyDiagnostics.buildHeartbeatJson(this)
            val hbResp = GatewayHttpClient.sendHeartbeat(baseUrl, token, telemetry)
            val serverTime = hbResp.optString("server_time", "")
            val serverEnabled = hbResp.optBoolean("device_enabled", true)
            val serverPaused = hbResp.optBoolean("device_paused", GatewayStorage.isGatewayPaused(this))
            val serverSimSlot = hbResp.optInt("selected_sim_slot", GatewayStorage.getSelectedSimSlot(this))

            GatewayStorage.recordHeartbeatSuccess(this, serverTime)
            GatewayStorage.setServiceState(
                this,
                enabled = serverEnabled,
                paused = serverPaused,
                selectedSimSlot = serverSimSlot,
            )

            // 2. Flush any offline status callbacks & offline inbound SMS
            flushOfflineStatusCallbacks(baseUrl, token)
            SmsBroadcastReceiver.flushOfflineInboundQueue(this)

            // 3. Poll & Transmit Outbound Jobs when active and not paused
            if (serverEnabled && !serverPaused) {
                val pollResp = GatewayHttpClient.pollJobs(baseUrl, token, limit = 10)
                val jobs = pollResp.optJSONArray("jobs")
                if (jobs != null) {
                    for (i in 0 until jobs.length()) {
                        val job = jobs.optJSONObject(i) ?: continue
                        processClaimedJob(baseUrl, token, job)
                    }
                }
            }

            if (GatewayStorage.isServiceRunning(this)) {
                updateNotification(currentStatusNotificationText())
            }
        } catch (exc: GatewayHttpException) {
            GatewayStorage.recordError(this, exc.message)
            if (exc.statusCode == 401 || exc.statusCode == 403) {
                updateNotification("EduSMS SIM Gateway — Device token revoked or unauthorized")
            }
        } catch (exc: Exception) {
            GatewayStorage.recordError(this, exc.message ?: "Network unreachable; offline queue active")
        } finally {
            syncInFlight = false
            GatewayEventBus.emit("gateway.service_state", TelephonyDiagnostics.collectDiagnosticsMap(this))
        }
    }

    private fun processClaimedJob(baseUrl: String, token: String, job: JSONObject) {
        val attemptId = job.optString("attempt_id", "")
        val messageId = job.optString("message_id", "")
        val recipient = job.optString("recipient_number", "")
        val body = job.optString("body", "")
        val simSlot = if (job.has("sim_slot") && !job.isNull("sim_slot")) {
            job.optInt("sim_slot", GatewayStorage.getSelectedSimSlot(this))
        } else {
            GatewayStorage.getSelectedSimSlot(this)
        }

        if (attemptId.isNotBlank()) {
            runCatching { GatewayHttpClient.ackJob(baseUrl, token, attemptId) }
        }

        val outcome = SmsTransmitter.transmit(
            context = this,
            attemptId = attemptId,
            messageId = messageId,
            destinationNumber = recipient,
            body = body,
            simSlot = simSlot,
        )

        if (!outcome.dispatched && !outcome.deduplicated) {
            val failPayload = JSONObject().apply {
                put("attempt_id", attemptId)
                put("message_id", messageId)
                put("event", "send_failed")
                put("event_type", "failed")
                put("result_code", outcome.errorCode.ifBlank { "HANDSET_REJECTED" })
                put("android_result_code", outcome.errorCode.ifBlank { "HANDSET_REJECTED" })
                put("detail", outcome.detail)
            }
            SmsStatusReceiver.dispatchOrQueueCallback(this, failPayload)
        }
    }

    private fun flushOfflineStatusCallbacks(baseUrl: String, token: String) {
        val items = GatewayStorage.drainOfflineStatusQueue(this)
        if (items.isEmpty()) return
        for (idx in items.indices) {
            try {
                GatewayHttpClient.postStatusCallback(baseUrl, token, items[idx])
            } catch (exc: Exception) {
                // Re-queue remaining callbacks if network fails mid-flush
                for (rem in idx until items.size) {
                    GatewayStorage.enqueueOfflineStatus(this, items[rem])
                }
                throw exc
            }
        }
    }

    private fun currentStatusNotificationText(): String {
        val paused = GatewayStorage.isGatewayPaused(this)
        val offlineCount = GatewayStorage.getOfflineInboundCount(this) + GatewayStorage.getOfflineStatusCount(this)
        val queueNote = if (offlineCount > 0) " ($offlineCount queued offline)" else ""
        return if (paused) {
            "EduSMS SIM Gateway Paused — Tap Resume to process SMS jobs$queueNote"
        } else {
            "EduSMS SIM Gateway Active — Connected & monitoring authorized SMS jobs$queueNote"
        }
    }

    private fun promoteToForeground(statusText: String) {
        val notification = buildNotification(statusText)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(
                NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC,
            )
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    private fun updateNotification(statusText: String) {
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager ?: return
        nm.notify(NOTIFICATION_ID, buildNotification(statusText))
    }

    private fun stopForegroundCompat() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            stopForeground(STOP_FOREGROUND_REMOVE)
        } else {
            @Suppress("DEPRECATION")
            stopForeground(true)
        }
    }

    private fun ensureNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val nm = getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager ?: return
            val channel = NotificationChannel(
                CHANNEL_ID,
                "EduSMS SIM Gateway Status",
                NotificationManager.IMPORTANCE_LOW,
            ).apply {
                description = "Persistent status indicator while EduSMS SIM Gateway is active."
                setShowBadge(false)
            }
            nm.createNotificationChannel(channel)
        }
    }

    private fun buildNotification(statusText: String): Notification {
        val paused = GatewayStorage.isGatewayPaused(this)
        val openAppIntent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val contentPi = PendingIntent.getActivity(
            this,
            100,
            openAppIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

        val toggleActionIntent = Intent(this, EduSmsGatewayService::class.java).apply {
            action = if (paused) ACTION_RESUME else ACTION_PAUSE
        }
        val togglePi = PendingIntent.getService(
            this,
            101,
            toggleActionIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

        val stopIntent = Intent(this, EduSmsGatewayService::class.java).apply {
            action = ACTION_STOP
        }
        val stopPi = PendingIntent.getService(
            this,
            102,
            stopIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(this, CHANNEL_ID)
        } else {
            @Suppress("DEPRECATION")
            Notification.Builder(this)
        }

        val toggleLabel = if (paused) "Resume" else "Pause"
        @Suppress("DEPRECATION")
        builder
            .setSmallIcon(android.R.drawable.stat_notify_chat)
            .setContentTitle(if (paused) "EduSMS SIM Gateway Paused" else "EduSMS SIM Gateway Active")
            .setContentText(statusText)
            .setContentIntent(contentPi)
            .setOngoing(true)
            .addAction(android.R.drawable.ic_media_pause, toggleLabel, togglePi)
            .addAction(android.R.drawable.ic_menu_close_clear_cancel, "Stop Gateway", stopPi)

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            builder.setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE)
        }
        return builder.build()
    }
}
