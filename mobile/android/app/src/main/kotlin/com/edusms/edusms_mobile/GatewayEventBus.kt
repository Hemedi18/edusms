package com.edusms.edusms_mobile

import android.os.Handler
import android.os.Looper
import io.flutter.plugin.common.EventChannel

/**
 * Thread-safe event bridge from native Android receivers/services to Flutter's EventChannel.
 */
object GatewayEventBus : EventChannel.StreamHandler {
    private val mainHandler = Handler(Looper.getMainLooper())

    @Volatile
    private var eventSink: EventChannel.EventSink? = null

    override fun onListen(arguments: Any?, events: EventChannel.EventSink?) {
        eventSink = events
    }

    override fun onCancel(arguments: Any?) {
        eventSink = null
    }

    fun emit(type: String, payload: Map<String, Any?>) {
        val envelope = HashMap<String, Any?>(payload.size + 2)
        envelope["type"] = type
        envelope["timestamp_ms"] = System.currentTimeMillis()
        envelope.putAll(payload)
        mainHandler.post {
            eventSink?.success(envelope)
        }
    }
}
