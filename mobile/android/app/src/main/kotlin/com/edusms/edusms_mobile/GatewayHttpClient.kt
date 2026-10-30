package com.edusms.edusms_mobile

import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL

class GatewayHttpException(
    val statusCode: Int,
    override val message: String,
) : Exception("HTTP $statusCode: $message")

/**
 * Lightweight zero-dependency HttpURLConnection JSON client authenticating with X-Gateway-Token.
 */
object GatewayHttpClient {
    private const val CONNECT_TIMEOUT_MS = 10_000
    private const val READ_TIMEOUT_MS = 15_000

    fun sendHeartbeat(apiBaseUrl: String, gatewayToken: String, telemetry: JSONObject): JSONObject {
        return postJson(
            url = "${apiBaseUrl.trimEnd('/')}/api/v1/devices/gateway/heartbeat/",
            gatewayToken = gatewayToken,
            body = telemetry,
        )
    }

    fun pollJobs(apiBaseUrl: String, gatewayToken: String, limit: Int = 10): JSONObject {
        val body = JSONObject().put("limit", limit)
        return postJson(
            url = "${apiBaseUrl.trimEnd('/')}/api/v1/devices/gateway/jobs/poll/",
            gatewayToken = gatewayToken,
            body = body,
        )
    }

    fun ackJob(apiBaseUrl: String, gatewayToken: String, attemptId: String): JSONObject {
        return postJson(
            url = "${apiBaseUrl.trimEnd('/')}/api/v1/devices/gateway/jobs/$attemptId/ack/",
            gatewayToken = gatewayToken,
            body = JSONObject(),
        )
    }

    fun syncInboundMessages(
        apiBaseUrl: String,
        gatewayToken: String,
        messages: JSONArray,
    ): JSONObject {
        val body = JSONObject().put("messages", messages)
        return postJson(
            url = "${apiBaseUrl.trimEnd('/')}/api/v1/devices/gateway/inbound/",
            gatewayToken = gatewayToken,
            body = body,
        )
    }

    fun postStatusCallback(
        apiBaseUrl: String,
        gatewayToken: String,
        payload: JSONObject,
    ): JSONObject {
        return postJson(
            url = "${apiBaseUrl.trimEnd('/')}/api/v1/devices/gateway/status-callback/",
            gatewayToken = gatewayToken,
            body = payload,
        )
    }

    private fun postJson(url: String, gatewayToken: String, body: JSONObject): JSONObject {
        if (gatewayToken.isBlank()) {
            throw GatewayHttpException(401, "Missing X-Gateway-Token on handset.")
        }
        val conn = (URL(url).openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"
            connectTimeout = CONNECT_TIMEOUT_MS
            readTimeout = READ_TIMEOUT_MS
            doInput = true
            doOutput = true
            useCaches = false
            setRequestProperty("Content-Type", "application/json; charset=utf-8")
            setRequestProperty("Accept", "application/json")
            setRequestProperty("X-Gateway-Token", gatewayToken)
            setRequestProperty("User-Agent", "EduSMS-Android-Gateway/1.0")
        }

        try {
            OutputStreamWriter(conn.outputStream, Charsets.UTF_8).use { writer ->
                writer.write(body.toString())
                writer.flush()
            }

            val code = conn.responseCode
            val stream = if (code in 200..299) conn.inputStream else conn.errorStream
            val rawText = if (stream != null) {
                BufferedReader(InputStreamReader(stream, Charsets.UTF_8)).use { it.readText() }
            } else {
                ""
            }

            if (code !in 200..299) {
                val parsedDetail = runCatching {
                    val errObj = JSONObject(rawText)
                    errObj.optJSONObject("error")?.optString("message")
                        ?: errObj.optString("detail", rawText)
                }.getOrDefault(rawText.ifBlank { "Gateway HTTP error $code" })
                throw GatewayHttpException(code, parsedDetail)
            }

            return if (rawText.isBlank()) JSONObject() else JSONObject(rawText)
        } finally {
            conn.disconnect()
        }
    }
}
