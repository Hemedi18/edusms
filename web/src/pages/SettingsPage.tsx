import React, { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";
import { User, Lock, ShieldAlert, Download, Trash2, KeyRound, Laptop, MailCheck } from "lucide-react";
import { api, tokenStore, unwrapList } from "../api/client";
import type { ThemeMode, UserSessionRecord } from "../types/api";
import { PageHeader, GlowCard } from "../components/States";
import { Modal } from "../components/Modal";
import { useAuth } from "../contexts/AuthContext";
import { useTheme } from "../contexts/ThemeContext";
import { useToast } from "../contexts/ToastContext";

export function SettingsPage() {
  const { user, updateProfile, refreshProfile, logout } = useAuth();
  const { themeMode, setThemeMode } = useTheme();
  const toast = useToast();
  const navigate = useNavigate();

  const [tab, setTab] = useState<"profile" | "security" | "privacy">("profile");

  // Profile fields
  const [fullName, setFullName] = useState(user?.full_name || "");
  const [organization, setOrganization] = useState(user?.organization || "");
  const [timezone, setTimezone] = useState(user?.timezone || "Africa/Dar_es_Salaam");
  const [countryCode, setCountryCode] = useState(user?.default_country_code || "TZ");
  const [dailyLimit, setDailyLimit] = useState(user?.daily_real_sms_limit ?? 250);
  const [requireConsent, setRequireConsent] = useState(user?.require_consent_for_campaigns ?? true);
  const [savingProfile, setSavingProfile] = useState(false);

  // Security: Password, MFA, Sessions
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [sessions, setSessions] = useState<UserSessionRecord[]>([]);
  const [mfaSetupData, setMfaSetupData] = useState<{ secret: string; provisioning_uri: string } | null>(null);
  const [mfaVerifyCode, setMfaVerifyCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [disableMfaPassword, setDisableMfaPassword] = useState("");

  // Privacy & Data
  const [retentionDays, setRetentionDays] = useState(user?.message_retention_days ?? 90);
  const [storeInboundBody, setStoreInboundBody] = useState(user?.store_inbound_message_body ?? true);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteConfirmWord, setDeleteConfirmWord] = useState("");

  useEffect(() => {
    if (user) {
      setFullName(user.full_name);
      setOrganization(user.organization);
      setTimezone(user.timezone);
      setCountryCode(user.default_country_code);
      setDailyLimit(user.daily_real_sms_limit);
      setRequireConsent(user.require_consent_for_campaigns);
      setRetentionDays(user.message_retention_days);
      setStoreInboundBody(user.store_inbound_message_body);
    }
  }, [user]);

  const loadSessions = useCallback(async () => {
    try {
      const sid = tokenStore.getSessionId() || "";
      const res = await api.get<UserSessionRecord[] | { results: UserSessionRecord[] }>(
        `/auth/sessions/?current_session_id=${encodeURIComponent(sid)}`
      );
      setSessions(unwrapList<UserSessionRecord>(res as UserSessionRecord[]));
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (tab === "security") {
      void loadSessions();
    }
  }, [tab, loadSessions]);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingProfile(true);
    try {
      await updateProfile({
        full_name: fullName.trim(),
        organization: organization.trim(),
        timezone,
        default_country_code: countryCode,
        theme_preference: themeMode,
        daily_real_sms_limit: dailyLimit,
        require_consent_for_campaigns: requireConsent,
      });
      toast.success("Profile Saved");
    } catch (err) {
      toast.error("Save failed", err instanceof Error ? err.message : "Could not update profile.");
    } finally {
      setSavingProfile(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.post("/auth/change-password/", {
        current_password: currentPassword,
        new_password: newPassword,
      });
      setCurrentPassword("");
      setNewPassword("");
      toast.success("Password Updated");
    } catch (err) {
      toast.error("Password change failed", err instanceof Error ? err.message : "Check current password.");
    }
  };

  const handleInitMfa = async () => {
    try {
      const data = await api.post<{ secret: string; provisioning_uri: string }>("/auth/mfa/setup/");
      setMfaSetupData(data);
    } catch (err) {
      toast.error("MFA setup error", err instanceof Error ? err.message : "Failed");
    }
  };

  const handleVerifyMfa = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await api.post<{ recovery_codes: string[] }>("/auth/mfa/verify/", {
        code: mfaVerifyCode.trim(),
      });
      setRecoveryCodes(res.recovery_codes);
      setMfaSetupData(null);
      setMfaVerifyCode("");
      await refreshProfile();
      toast.success("TOTP Multi-Factor Authentication Enabled");
    } catch (err) {
      toast.error("Invalid TOTP code", err instanceof Error ? err.message : "Verification failed.");
    }
  };

  const handleDisableMfa = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.post("/auth/mfa/disable/", { password: disableMfaPassword });
      setDisableMfaPassword("");
      await refreshProfile();
      toast.info("MFA Disabled");
    } catch (err) {
      toast.error("Disable MFA failed", err instanceof Error ? err.message : "Incorrect password.");
    }
  };

  const handleSavePrivacy = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await updateProfile({
        message_retention_days: retentionDays,
        store_inbound_message_body: storeInboundBody,
      });
      toast.success("Privacy & Retention Preferences Saved");
    } catch (err) {
      toast.error("Update failed", err instanceof Error ? err.message : "Error");
    }
  };

  const handleDeleteAccount = async () => {
    try {
      await api.post("/auth/delete-account/", {
        password: deletePassword,
        confirmation: deleteConfirmWord,
      });
      await logout();
      toast.info("Account Permanently Deleted");
      navigate("/login");
    } catch (err) {
      toast.error("Deletion blocked", err instanceof Error ? err.message : "Check password & confirmation.");
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Account, Security & Privacy Settings"
        subtitle="Manage your profile, TOTP multi-factor authentication, active login sessions, data retention, and exports."
      />

      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border-subtle)] pb-3">
        {(
          [
            { id: "profile", label: "Profile & Preferences", Icon: User },
            { id: "security", label: "Security, MFA & Sessions", Icon: Lock },
            { id: "privacy", label: "Privacy, Retention & Data", Icon: ShieldAlert },
          ] as const
        ).map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-medium border cursor-pointer ${
              tab === id
                ? "bg-violet-600 text-white border-violet-500"
                : "bg-[var(--bg-surface)] text-[var(--text-secondary)] border-[var(--border-subtle)]"
            }`}
          >
            <Icon className="w-3.5 h-3.5" />
            <span>{label}</span>
          </button>
        ))}
      </div>

      {tab === "profile" ? (
        <form onSubmit={handleSaveProfile} className="surface-card p-6 max-w-2xl space-y-4">
          <div className="flex items-center justify-between p-3 surface-elevated text-xs">
            <div>
              <span className="font-semibold">{user?.email}</span>{" "}
              <span className="ml-2 text-[var(--text-muted)]">
                ({user?.email_verified ? "Verified" : "Unverified"})
              </span>
            </div>
            {!user?.email_verified && (
              <button
                type="button"
                onClick={async () => {
                  await api.post("/auth/resend-verification/");
                  toast.success("Verification Link Sent");
                }}
                className="btn-secondary text-xs py-1 px-2.5"
              >
                <MailCheck className="w-3.5 h-3.5 text-cyan-400" />
                <span>Resend Verification</span>
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="prof-name" className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                Full Name
              </label>
              <input
                id="prof-name"
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="input-field"
                required
              />
            </div>
            <div>
              <label htmlFor="prof-org" className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                Organization
              </label>
              <input
                id="prof-org"
                type="text"
                value={organization}
                onChange={(e) => setOrganization(e.target.value)}
                className="input-field"
              />
            </div>
            <div>
              <label htmlFor="prof-tz" className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                Timezone
              </label>
              <input
                id="prof-tz"
                type="text"
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                className="input-field"
              />
            </div>
            <div>
              <label htmlFor="prof-cc" className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                Default Country Code
              </label>
              <input
                id="prof-cc"
                type="text"
                maxLength={4}
                value={countryCode}
                onChange={(e) => setCountryCode(e.target.value.toUpperCase())}
                className="input-field font-mono"
              />
            </div>
            <div>
              <label htmlFor="prof-theme" className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                Appearance Theme
              </label>
              <select
                id="prof-theme"
                value={themeMode}
                onChange={(e) => setThemeMode(e.target.value as ThemeMode)}
                className="input-field"
              >
                <option value="dark">Dark Mode</option>
                <option value="light">Light Mode</option>
                <option value="system">System Preference</option>
              </select>
            </div>
            <div>
              <label htmlFor="prof-limit" className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                Daily Real Carrier SMS Safety Cap
              </label>
              <input
                id="prof-limit"
                type="number"
                min={1}
                value={dailyLimit}
                onChange={(e) => setDailyLimit(Number(e.target.value))}
                className="input-field"
              />
            </div>
          </div>

          <label className="surface-elevated p-3 flex items-center gap-2.5 text-xs cursor-pointer">
            <input
              type="checkbox"
              checked={requireConsent}
              onChange={(e) => setRequireConsent(e.target.checked)}
            />
            <span>Require explicit opt-in consent before real SIM/provider bulk campaigns</span>
          </label>

          <button type="submit" disabled={savingProfile} className="btn-primary text-xs">
            {savingProfile ? "Saving..." : "Save Profile & Preferences"}
          </button>
        </form>
      ) : tab === "security" ? (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {/* Password Change */}
            <form onSubmit={handleChangePassword} className="surface-card p-5 space-y-3.5">
              <h2 className="text-sm font-semibold">Change Account Password</h2>
              <div>
                <label className="block text-xs text-[var(--text-secondary)] mb-1">Current Password</label>
                <input
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  className="input-field"
                  required
                />
              </div>
              <div>
                <label className="block text-xs text-[var(--text-secondary)] mb-1">
                  New Password (min 10 characters)
                </label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="input-field"
                  required
                />
              </div>
              <button type="submit" className="btn-primary text-xs">
                Update Password
              </button>
            </form>

            {/* TOTP MFA */}
            <GlowCard active={Boolean(user?.mfa_enabled)} className="space-y-3.5">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold flex items-center gap-2">
                  <KeyRound className="w-4 h-4 text-violet-400" />
                  <span>TOTP Multi-Factor Authentication</span>
                </h2>
                <span
                  className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                    user?.mfa_enabled ? "bg-emerald-500/15 text-emerald-400" : "bg-slate-500/15 text-[var(--text-muted)]"
                  }`}
                >
                  {user?.mfa_enabled ? "Enabled" : "Not Enabled"}
                </span>
              </div>

              {!user?.mfa_enabled ? (
                !mfaSetupData ? (
                  <div className="space-y-2">
                    <p className="text-xs text-[var(--text-secondary)]">
                      Protect your SMS gateway credentials with a 6-digit TOTP authenticator app and single-use recovery
                      codes.
                    </p>
                    <button type="button" onClick={handleInitMfa} className="btn-primary text-xs">
                      Set Up Authenticator App
                    </button>
                  </div>
                ) : (
                  <form onSubmit={handleVerifyMfa} className="space-y-3">
                    <div className="inline-block p-3 rounded-xl bg-white">
                      <QRCodeSVG value={mfaSetupData.provisioning_uri} size={140} />
                    </div>
                    <div className="text-xs font-mono">Secret: {mfaSetupData.secret}</div>
                    <input
                      type="text"
                      value={mfaVerifyCode}
                      onChange={(e) => setMfaVerifyCode(e.target.value)}
                      placeholder="Enter 6-digit code to activate"
                      className="input-field font-mono text-xs"
                      required
                    />
                    <button type="submit" className="btn-primary text-xs">
                      Verify & Enable MFA
                    </button>
                  </form>
                )
              ) : (
                <form onSubmit={handleDisableMfa} className="space-y-3">
                  <p className="text-xs text-[var(--text-secondary)]">
                    Confirm your password to disable TOTP multi-factor authentication.
                  </p>
                  <input
                    type="password"
                    value={disableMfaPassword}
                    onChange={(e) => setDisableMfaPassword(e.target.value)}
                    placeholder="Account password"
                    className="input-field text-xs"
                    required
                  />
                  <button type="submit" className="btn-danger text-xs">
                    Disable MFA
                  </button>
                </form>
              )}

              {recoveryCodes && (
                <div className="surface-elevated p-3 text-xs space-y-1.5">
                  <div className="font-semibold text-amber-400">Save Your Recovery Codes Now:</div>
                  <div className="grid grid-cols-2 gap-1 font-mono">{recoveryCodes.map((c) => <span key={c}>{c}</span>)}</div>
                </div>
              )}
            </GlowCard>
          </div>

          {/* Active Sessions */}
          <div className="surface-card p-5 space-y-3">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <Laptop className="w-4 h-4 text-cyan-400" />
              <span>Active Login Sessions ({sessions.length})</span>
            </h3>
            <div className="space-y-2">
              {sessions.map((s) => (
                <div key={s.id} className="surface-elevated p-3 flex items-center justify-between text-xs">
                  <div>
                    <span className="font-semibold">{s.device_label}</span>{" "}
                    {s.is_current && (
                      <span className="ml-1.5 px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-400 text-[10px]">
                        Current Session
                      </span>
                    )}
                    <div className="text-[11px] text-[var(--text-muted)] mt-0.5">
                      IP: {s.ip_address || "Unknown"} · Last active {new Date(s.last_used_at).toLocaleString()}
                    </div>
                  </div>
                  {!s.is_current && (
                    <button
                      type="button"
                      onClick={async () => {
                        await api.post(`/auth/sessions/${s.id}/revoke/`);
                        toast.info("Session Revoked");
                        void loadSessions();
                      }}
                      className="btn-secondary text-xs py-1 px-2.5 text-rose-400"
                    >
                      Revoke
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : (
        /* Privacy, Retention & Data */
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <form onSubmit={handleSavePrivacy} className="surface-card p-5 space-y-4">
            <h2 className="text-sm font-semibold">Message Retention & Inbound SMS Privacy</h2>
            <div>
              <label htmlFor="priv-retention" className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                Message Retention Window (days)
              </label>
              <input
                id="priv-retention"
                type="number"
                min={7}
                max={3650}
                value={retentionDays}
                onChange={(e) => setRetentionDays(Number(e.target.value))}
                className="input-field w-40"
              />
            </div>

            <label className="surface-elevated p-3.5 flex items-start gap-2.5 text-xs cursor-pointer">
              <input
                type="checkbox"
                checked={!storeInboundBody}
                onChange={(e) => setStoreInboundBody(!e.target.checked)}
                className="mt-0.5"
              />
              <div>
                <div className="font-semibold text-[var(--text-primary)]">
                  Redact Inbound SMS Message Bodies at Rest
                </div>
                <p className="text-[var(--text-secondary)] mt-0.5">
                  When enabled, auto-reply rules evaluate incoming text in memory and store <code>[REDACTED]</code> in
                  the database to protect sensitive personal SMS content.
                </p>
              </div>
            </label>

            <button type="submit" className="btn-primary text-xs">
              Save Privacy Controls
            </button>
          </form>

          <div className="space-y-4">
            <div className="surface-card p-5 space-y-3">
              <h2 className="text-sm font-semibold">Export Account JSON Archive</h2>
              <p className="text-xs text-[var(--text-secondary)]">
                Download a portable JSON archive of your account profile, contacts, groups, suppressions, rules,
                campaigns, and recent messages.
              </p>
              <button
                type="button"
                onClick={() => void api.downloadFile("/auth/export/", "edusms_account_export.json")}
                className="btn-secondary text-xs"
              >
                <Download className="w-4 h-4 text-cyan-400" />
                <span>Download JSON Data Export</span>
              </button>
            </div>

            <div className="surface-card p-5 border-rose-500/35 space-y-3">
              <h2 className="text-sm font-semibold text-rose-400">Danger Zone — Delete Account</h2>
              <p className="text-xs text-[var(--text-secondary)]">
                Permanently deletes your EduSMS account, revokes all paired devices and API keys, and erases stored
                messages.
              </p>
              <button
                type="button"
                onClick={() => setDeleteModalOpen(true)}
                className="btn-danger text-xs"
              >
                <Trash2 className="w-4 h-4" />
                <span>Delete Account Permanently</span>
              </button>
            </div>
          </div>
        </div>
      )}

      <Modal
        open={deleteModalOpen}
        onClose={() => setDeleteModalOpen(false)}
        title="Permanently Delete EduSMS Account"
        footer={
          <>
            <button type="button" onClick={() => setDeleteModalOpen(false)} className="btn-secondary">
              Cancel
            </button>
            <button
              type="button"
              disabled={deleteConfirmWord !== "DELETE" || !deletePassword}
              onClick={handleDeleteAccount}
              className="btn-danger"
            >
              Confirm Permanent Deletion
            </button>
          </>
        }
      >
        <div className="space-y-3 text-xs">
          <p className="text-[var(--text-secondary)]">
            Enter your password and type <code>DELETE</code> to confirm permanent erasure.
          </p>
          <input
            type="password"
            value={deletePassword}
            onChange={(e) => setDeletePassword(e.target.value)}
            placeholder="Current password"
            className="input-field"
          />
          <input
            type="text"
            value={deleteConfirmWord}
            onChange={(e) => setDeleteConfirmWord(e.target.value)}
            placeholder="Type DELETE"
            className="input-field font-mono"
          />
        </div>
      </Modal>
    </div>
  );
}
