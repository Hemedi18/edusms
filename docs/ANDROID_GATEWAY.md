# EduSMS — Android SIM Gateway & iOS Companion Architecture

EduSMS turns a user-owned Android smartphone containing a physical SIM card (or Dual-SIM / eSIM subscriptions) into an authenticated, programmable SMS gateway while providing an honest, full-featured Companion App on iOS.

---

## 1. Platform Honesty: Android vs. iOS

| Capability | Android Physical Handset | iOS Companion App |
| :--- | :--- | :--- |
| **Background Outbound SMS via Device SIM** | Supported via `SmsManager` + `EduSmsGatewayService` (`SEND_SMS`) | **Not supported** by Apple iOS sandboxing (`MFMessageComposeViewController` requires manual per-message user tap) |
| **Automated Inbound SMS Capture & Sync** | Supported via `SmsBroadcastReceiver` (`SMS_RECEIVED`) | **Not supported** by iOS third-party app sandbox |
| **Multi-SIM Slot Discovery & Selection** | Supported via `SubscriptionManager` (`READ_PHONE_STATE`) | N/A |
| **Remote Management of Paired Android Gateways** | Full | Full |
| **Dashboard, Contacts, Automation, Campaigns, API Keys & Simulation Lab** | Full | Full |

EduSMS **never** claims background SIM gateway transmission on iOS; `PlatformCapabilities` in the Flutter app explicitly surfaces iOS Companion Mode and guides users to pair an Android handset or use Simulation Mode / External SMS Providers.

---

## 2. Native Android Kotlin Telephony Components

All native gateway components reside under `mobile/android/app/src/main/kotlin/com/edusms/edusms_mobile/`:

```text
Flutter UI (Riverpod + GoRouter)
   │  MethodChannel("com.edusms.gateway/methods")
   │  EventChannel("com.edusms.gateway/events")
   ▼
MainActivity.kt
   ├── TelephonyDiagnostics.kt   (Permissions, SubscriptionManager SIM slots, Battery, RoleManager)
   ├── EduSmsGatewayService.kt   (Visible Foreground Service: Heartbeat + Poll + Ack + Offline Flush)
   ├── SmsTransmitter.kt         (Multi-SIM SmsManager, Multipart divideMessage, Attempt Idempotency)
   ├── SmsStatusReceiver.kt      (SMS_SENT -> submitted / failed; SMS_DELIVERED PDU -> delivered)
   ├── SmsBroadcastReceiver.kt   (SMS_RECEIVED capture, SHA-256 external_message_id, Offline Queue)
   ├── GatewayStorage.kt         (Thread-safe persistent prefs, offline queues & sent attempt LRU)
   └── GatewayHttpClient.kt      (Authenticated X-Gateway-Token HTTPS sync client)
```

### 2.1 Foreground Service & User Control (`EduSmsGatewayService.kt`)
- Declared with `android:foregroundServiceType="dataSync"` (`FOREGROUND_SERVICE` + `FOREGROUND_SERVICE_DATA_SYNC`).
- Always displays a persistent notification showing connection status and quick actions (**Pause** / **Stop Gateway**).
- Executes a periodic sync cycle:
  1. Sends hardware/SIM/permission telemetry to `POST /api/v1/devices/gateway/heartbeat/`.
  2. Flushes any offline-queued inbound SMS or radio status callbacks.
  3. Polls `POST /api/v1/devices/gateway/jobs/poll/`, acknowledges each claimed `attempt_id` (`POST .../ack/`), and hands off to `SmsTransmitter`.

### 2.2 Multi-SIM & Multipart Outbound Transmission (`SmsTransmitter.kt`)
- Queries `SubscriptionManager.activeSubscriptionInfoList` to map `sim_slot` (`0`, `1`, …) to Android `subscriptionId`.
- On Android 12+ (`API >= 31`), obtains the subscription-scoped radio manager via `context.getSystemService(SmsManager::class.java).createForSubscriptionId(subId)` (falling back cleanly on Android 8–11).
- Records `attempt_id` in `GatewayStorage` **before** radio dispatch so network timeouts or app restarts never double-send the same SMS job.
- Splits messages longer than 160 GSM-7 / 70 UCS-2 characters via `smsManager.divideMessage(body)` and dispatches via `sendMultipartTextMessage` with per-part `PendingIntent`s.

### 2.3 Honest Transmission vs. Carrier Delivery Callbacks (`SmsStatusReceiver.kt`)
- **`SMS_SENT` (`Activity.RESULT_OK`)**: Reports `event = "sent"` to `/api/v1/devices/gateway/status-callback/`, transitioning the backend message to **`submitted`** ("Accepted for transmission by handset/radio") — **never** `delivered`.
- **`SMS_SENT` (`RESULT_ERROR_GENERIC_FAILURE`, `RESULT_ERROR_NO_SERVICE`, `RESULT_ERROR_RADIO_OFF`, `RESULT_ERROR_NULL_PDU`)**: Reports `event = "failed"` with the exact Android error code so campaigns and dashboards show actionable diagnostics.
- **`SMS_DELIVERED`**: Parses the carrier status report PDU (`SmsMessage.createFromPdu`) and reports `event = "delivered"` only when the mobile operator confirms delivery (`status == 0`).

### 2.4 Inbound SMS Capture, Offline Queue & Deduplication (`SmsBroadcastReceiver.kt`)
- Listens to `android.provider.Telephony.SMS_RECEIVED`.
- Reassembles multi-part inbound PDUs from the same sender and captures sender number, body, timestamp, and receiving SIM slot.
- Generates a deterministic `external_message_id` (`SHA-256(deviceIdentity + sender + timestampMillis + body)`).
- Persists the event immediately to `GatewayStorage`'s local offline queue before attempting HTTP sync to `/api/v1/devices/gateway/inbound/`. If cellular/Wi-Fi data is temporarily unavailable, `EduSmsGatewayService` automatically flushes the queue once connectivity returns, and Django deduplicates retries via `(user, device, external_message_id)`.

---

## 3. Permissions, Default SMS Role & Distribution Guidance

### Required Runtime Permissions
EduSMS explains **why** each permission is needed in an in-app onboarding screen before triggering Android OS prompts:
- `SEND_SMS` — Transmit user-authorized outbound messages and auto-replies through the selected SIM.
- `RECEIVE_SMS` / `READ_SMS` — Detect incoming SMS messages so they can sync to your EduSMS inbox and trigger your configured rules.
- `READ_PHONE_STATE` — Enumerate Dual-SIM / eSIM slots and carrier state.
- `POST_NOTIFICATIONS` (Android 13+) — Display the persistent foreground gateway status notification.

### Default SMS Handler Role (`RoleManager.ROLE_SMS`) vs. Direct Distribution
- Standard `SMS_RECEIVED` broadcast listening + `SmsManager` sending works on Android **without** forcing EduSMS to replace the user's everyday Messages app, provided runtime SMS permissions are granted.
- Optional Default SMS Role elevation (`requestDefaultSmsRole`) is surfaced for dedicated gateway phones where OEM ROM restrictions require `ROLE_SMS`.
- **Google Play Policy Note**: Google Play restricts `SEND_SMS` / `RECEIVE_SMS` permissions to default SMS handlers or approved enterprise/device-automation use cases. For developer, student, research, and self-hosted deployments, EduSMS APK builds can be installed directly via ADB or self-hosted enterprise distribution, with Android 13+ "Allow restricted settings" instructions documented in the app's Diagnostics screen.

### OEM Battery Optimization Guidance
Vendors with aggressive background task killers (Xiaomi MIUI/HyperOS, Samsung One UI, Huawei EMUI, Oppo ColorOS, Tecno HiOS, Infinix XOS) may suspend background services unless exempted. On dedicated gateway handsets:
1. Set EduSMS Battery Usage to **Unrestricted** in Android App Info.
2. Keep the persistent **EduSMS SIM Gateway Active** foreground notification enabled.
3. Connect the gateway phone to continuous USB power for high-volume scheduled campaigns.
