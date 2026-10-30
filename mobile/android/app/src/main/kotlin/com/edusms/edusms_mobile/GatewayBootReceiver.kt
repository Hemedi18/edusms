package com.edusms.edusms_mobile

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Resumes the visible EduSMS Foreground Gateway Service after device reboot ONLY when:
 * 1. The user explicitly enabled auto-resume on boot,
 * 2. Gateway mode is enabled, AND
 * 3. A paired gateway_token exists on the handset.
 */
class GatewayBootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action ?: return
        if (action != Intent.ACTION_BOOT_COMPLETED && action != Intent.ACTION_MY_PACKAGE_REPLACED) {
            return
        }
        val appCtx = context.applicationContext
        val shouldResume = GatewayStorage.isAutoResumeOnBoot(appCtx) &&
            GatewayStorage.isGatewayEnabled(appCtx) &&
            GatewayStorage.getGatewayToken(appCtx).isNotBlank()

        if (shouldResume) {
            EduSmsGatewayService.startServiceIntent(appCtx, EduSmsGatewayService.ACTION_START)
        }
    }
}
