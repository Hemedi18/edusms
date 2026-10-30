import React, { useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { ShieldCheck, Sparkles, KeyRound, Mail, ArrowRight, Sun, Moon, Monitor } from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import { useTheme } from "../contexts/ThemeContext";
import { useToast } from "../contexts/ToastContext";
import { api, ApiError } from "../api/client";
import type { ThemeMode } from "../types/api";

type AuthMode = "login" | "register" | "forgot" | "reset" | "verify";

export function AuthPage({ mode: propMode }: { mode?: AuthMode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { login, register, isAuthenticated } = useAuth();
  const { themeMode, setThemeMode } = useTheme();
  const toast = useToast();

  const activeMode: AuthMode =
    propMode ||
    (location.pathname.includes("register")
      ? "register"
      : location.pathname.includes("forgot")
        ? "forgot"
        : location.pathname.includes("reset")
          ? "reset"
          : location.pathname.includes("verify")
            ? "verify"
            : "login");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [organization, setOrganization] = useState("");
  const [timezone, setTimezone] = useState("Africa/Dar_es_Salaam");
  const [countryCode, setCountryCode] = useState("TZ");
  const [mfaCode, setMfaCode] = useState("");
  const [showMfaField, setShowMfaField] = useState(false);

  const [actionToken, setActionToken] = useState(() => searchParams.get("token") || "");
  const [newPassword, setNewPassword] = useState("");

  const [errorMessage, setErrorMessage] = useState("");
  const [infoMessage, setInfoMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (isAuthenticated && (activeMode === "login" || activeMode === "register")) {
      const from = (location.state as { from?: string } | null)?.from || "/";
      navigate(from, { replace: true });
    }
  }, [isAuthenticated, activeMode, navigate, location.state]);

  const fillDemoCredentials = () => {
    setEmail("demo@edusms.local");
    setPassword("EduSMSDemo!2026");
    setFullName("Demo Instructor");
    setOrganization("University ICT Lab");
    setErrorMessage("");
    setInfoMessage("Demo credentials filled. Click Sign In (or Create Demo Workspace if first run).");
  };

  const handleQuickDemoWorkspace = async () => {
    setErrorMessage("");
    setSubmitting(true);
    const demoEmail = "demo@edusms.local";
    const demoPass = "EduSMSDemo!2026";
    try {
      await login({ email: demoEmail, password: demoPass, device_label: "Web Dashboard" });
      toast.success("Signed in to Demo Workspace");
      navigate("/");
    } catch {
      try {
        await register({
          email: demoEmail,
          full_name: "Demo Instructor",
          organization: "University ICT Lab",
          password: demoPass,
          timezone: "Africa/Dar_es_Salaam",
          default_country_code: "TZ",
        });
        await api.post("/simulation/seed-demo/").catch(() => null);
        toast.success("Created & seeded Demo Workspace!");
        navigate("/");
      } catch (regErr) {
        setErrorMessage(regErr instanceof Error ? regErr.message : "Could not initialize demo workspace.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage("");
    setInfoMessage("");

    if (activeMode === "login") {
      if (!email.trim() || !password) {
        setErrorMessage("Please enter both your email address and password.");
        return;
      }
      setSubmitting(true);
      try {
        await login({
          email: email.trim(),
          password,
          mfa_code: mfaCode.trim() || undefined,
          device_label: "Web Dashboard",
        });
        toast.success("Welcome back!");
        const dest = (location.state as { from?: string } | null)?.from || "/";
        navigate(dest, { replace: true });
      } catch (err) {
        if (err instanceof ApiError && (err.details.mfa_required || err.message.includes("mfa_required"))) {
          setShowMfaField(true);
          setErrorMessage("Enter your 6-digit authenticator code (or recovery code) to continue.");
        } else {
          setErrorMessage(err instanceof Error ? err.message : "Sign in failed.");
        }
      } finally {
        setSubmitting(false);
      }
      return;
    }

    if (activeMode === "register") {
      if (!fullName.trim()) {
        setErrorMessage("Full name is required.");
        return;
      }
      if (!email.trim() || !email.includes("@")) {
        setErrorMessage("Please enter a valid email address.");
        return;
      }
      if (password.length < 10) {
        setErrorMessage("Password must be at least 10 characters long.");
        return;
      }
      setSubmitting(true);
      try {
        await register({
          email: email.trim(),
          full_name: fullName.trim(),
          organization: organization.trim(),
          password,
          timezone,
          default_country_code: countryCode,
        });
        toast.success("Account created!", "Welcome to EduSMS.");
        navigate("/");
      } catch (err) {
        setErrorMessage(err instanceof Error ? err.message : "Registration failed.");
      } finally {
        setSubmitting(false);
      }
      return;
    }

    if (activeMode === "forgot") {
      if (!email.trim()) {
        setErrorMessage("Please enter your account email.");
        return;
      }
      setSubmitting(true);
      try {
        await api.post("/auth/password-reset/", { email: email.trim() }, { skipAuth: true });
        setInfoMessage("If an active account exists for this email, reset instructions have been sent.");
      } catch (err) {
        setErrorMessage(err instanceof Error ? err.message : "Request failed.");
      } finally {
        setSubmitting(false);
      }
      return;
    }

    if (activeMode === "reset") {
      if (!actionToken.trim() || newPassword.length < 10) {
        setErrorMessage("Reset token and a new password (min 10 characters) are required.");
        return;
      }
      setSubmitting(true);
      try {
        await api.post(
          "/auth/password-reset/confirm/",
          { token: actionToken.trim(), new_password: newPassword },
          { skipAuth: true }
        );
        toast.success("Password updated", "You can now sign in with your new password.");
        navigate("/login");
      } catch (err) {
        setErrorMessage(err instanceof Error ? err.message : "Reset failed.");
      } finally {
        setSubmitting(false);
      }
      return;
    }

    if (activeMode === "verify") {
      if (!actionToken.trim()) {
        setErrorMessage("Verification token is required.");
        return;
      }
      setSubmitting(true);
      try {
        await api.post("/auth/verify-email/", { token: actionToken.trim() }, { skipAuth: true });
        setInfoMessage("Email verified! You may return to your dashboard.");
        toast.success("Email verified");
      } catch (err) {
        setErrorMessage(err instanceof Error ? err.message : "Verification failed.");
      } finally {
        setSubmitting(false);
      }
    }
  };

  return (
    <div className="min-h-screen flex flex-col justify-between bg-[var(--bg-canvas)] text-[var(--text-primary)] p-4 sm:p-8">
      {/* Top Bar */}
      <div className="max-w-5xl w-full mx-auto flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-600 to-cyan-500 text-white font-bold flex items-center justify-center shadow-md">
            E
          </div>
          <div>
            <span className="font-bold tracking-tight">EduSMS</span>
            <span className="hidden sm:inline text-xs text-[var(--text-muted)] ml-2">
              Android SIM Gateway · Automation · Simulation Sandbox
            </span>
          </div>
        </div>

        <div
          role="group"
          aria-label="Theme switcher"
          className="inline-flex items-center p-0.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)]"
        >
          {(
            [
              { m: "dark", label: "Dark", Icon: Moon },
              { m: "light", label: "Light", Icon: Sun },
              { m: "system", label: "System", Icon: Monitor },
            ] as Array<{ m: ThemeMode; label: string; Icon: typeof Sun }>
          ).map(({ m, label, Icon }) => (
            <button
              key={m}
              type="button"
              aria-label={`${label} theme`}
              aria-pressed={themeMode === m}
              onClick={() => setThemeMode(m)}
              className={`px-2 py-1 rounded-md text-xs flex items-center gap-1 cursor-pointer ${
                themeMode === m
                  ? "bg-[var(--bg-elevated)] text-[var(--text-primary)] font-medium"
                  : "text-[var(--text-muted)]"
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Auth Card */}
      <div className="max-w-md w-full mx-auto my-8">
        <div className="glow-card p-6 sm:p-8">
          <div className="mb-6">
            <h1 className="text-xl font-bold text-[var(--text-primary)]">
              {activeMode === "login" && "Sign in to EduSMS"}
              {activeMode === "register" && "Create your EduSMS account"}
              {activeMode === "forgot" && "Reset your password"}
              {activeMode === "reset" && "Set a new password"}
              {activeMode === "verify" && "Verify email address"}
            </h1>
            <p className="text-xs text-[var(--text-secondary)] mt-1">
              {activeMode === "login" &&
                "Manage Android SIM gateways, keyword/AI auto-replies, bulk campaigns, and Simulation Mode."}
              {activeMode === "register" &&
                "Starts safely in Simulation Sandbox Mode — zero carrier SMS charges until you pair a physical SIM."}
              {activeMode === "forgot" && "Enter your email to request a 30-minute single-use password reset token."}
              {activeMode === "reset" && "Paste your reset token and choose a strong password (10+ characters)."}
              {activeMode === "verify" && "Confirm your email verification token."}
            </p>
          </div>

          {errorMessage && (
            <div
              role="alert"
              className="mb-4 p-3 rounded-xl bg-rose-500/12 border border-rose-500/35 text-xs text-rose-500 dark:text-rose-300"
            >
              {errorMessage}
            </div>
          )}

          {infoMessage && (
            <div
              role="status"
              className="mb-4 p-3 rounded-xl bg-cyan-500/12 border border-cyan-500/35 text-xs text-cyan-700 dark:text-cyan-300"
            >
              {infoMessage}
            </div>
          )}

          <form onSubmit={handleSubmit} noValidate className="space-y-4">
            {activeMode === "register" && (
              <>
                <div>
                  <label htmlFor="auth-fullname" className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                    Full Name
                  </label>
                  <input
                    id="auth-fullname"
                    type="text"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Dr. Amina Mwakasege"
                    className="input-field"
                    required
                  />
                </div>
                <div>
                  <label htmlFor="auth-org" className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                    Organization / Institution (Optional)
                  </label>
                  <input
                    id="auth-org"
                    type="text"
                    value={organization}
                    onChange={(e) => setOrganization(e.target.value)}
                    placeholder="Department of Computer Science"
                    className="input-field"
                  />
                </div>
              </>
            )}

            {(activeMode === "login" || activeMode === "register" || activeMode === "forgot") && (
              <div>
                <label htmlFor="auth-email" className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                  Email Address
                </label>
                <input
                  id="auth-email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@institution.ac.tz"
                  className="input-field"
                  required
                />
              </div>
            )}

            {(activeMode === "login" || activeMode === "register") && (
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label htmlFor="auth-password" className="text-xs font-medium text-[var(--text-secondary)]">
                    Password {activeMode === "register" && "(min 10 chars)"}
                  </label>
                  {activeMode === "login" && (
                    <Link to="/forgot-password" className="text-xs text-violet-400 hover:underline">
                      Forgot password?
                    </Link>
                  )}
                </div>
                <input
                  id="auth-password"
                  type="password"
                  autoComplete={activeMode === "login" ? "current-password" : "new-password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••••"
                  className="input-field"
                  required
                />
              </div>
            )}

            {activeMode === "register" && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="auth-tz" className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                    Timezone
                  </label>
                  <select
                    id="auth-tz"
                    value={timezone}
                    onChange={(e) => setTimezone(e.target.value)}
                    className="input-field"
                  >
                    <option value="Africa/Dar_es_Salaam">Africa/Dar_es_Salaam</option>
                    <option value="Africa/Nairobi">Africa/Nairobi</option>
                    <option value="UTC">UTC</option>
                    <option value="Europe/London">Europe/London</option>
                    <option value="America/New_York">America/New_York</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="auth-cc" className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                    Default Country
                  </label>
                  <select
                    id="auth-cc"
                    value={countryCode}
                    onChange={(e) => setCountryCode(e.target.value)}
                    className="input-field"
                  >
                    <option value="TZ">Tanzania (+255)</option>
                    <option value="KE">Kenya (+254)</option>
                    <option value="UG">Uganda (+256)</option>
                    <option value="US">United States (+1)</option>
                    <option value="GB">United Kingdom (+44)</option>
                  </select>
                </div>
              </div>
            )}

            {activeMode === "login" && (
              <div>
                {!showMfaField ? (
                  <button
                    type="button"
                    onClick={() => setShowMfaField(true)}
                    className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] inline-flex items-center gap-1 cursor-pointer"
                  >
                    <KeyRound className="w-3.5 h-3.5" />
                    <span>Have a TOTP / MFA code?</span>
                  </button>
                ) : (
                  <div>
                    <label htmlFor="auth-mfa" className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                      Authenticator / Recovery Code
                    </label>
                    <input
                      id="auth-mfa"
                      type="text"
                      inputMode="numeric"
                      value={mfaCode}
                      onChange={(e) => setMfaCode(e.target.value)}
                      placeholder="6-digit TOTP or recovery code"
                      className="input-field"
                    />
                  </div>
                )}
              </div>
            )}

            {(activeMode === "reset" || activeMode === "verify") && (
              <div>
                <label htmlFor="auth-token" className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                  Security Token
                </label>
                <input
                  id="auth-token"
                  type="text"
                  value={actionToken}
                  onChange={(e) => setActionToken(e.target.value)}
                  placeholder="Paste token from email"
                  className="input-field"
                  required
                />
              </div>
            )}

            {activeMode === "reset" && (
              <div>
                <label htmlFor="auth-newpass" className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                  New Password (min 10 characters)
                </label>
                <input
                  id="auth-newpass"
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="••••••••••••"
                  className="input-field"
                  required
                />
              </div>
            )}

            <button type="submit" disabled={submitting} className="btn-primary w-full py-2.5">
              <span>
                {submitting
                  ? "Please wait..."
                  : activeMode === "login"
                    ? "Sign In"
                    : activeMode === "register"
                      ? "Create Account"
                      : activeMode === "forgot"
                        ? "Send Reset Link"
                        : activeMode === "reset"
                          ? "Save New Password"
                          : "Verify Email"}
              </span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>

          {activeMode === "login" && (
            <div className="mt-5 pt-4 border-t border-[var(--border-subtle)] space-y-2">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={fillDemoCredentials}
                  className="btn-secondary flex-1 text-xs py-2"
                >
                  <Mail className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Fill Demo Credentials</span>
                </button>
                <button
                  type="button"
                  onClick={handleQuickDemoWorkspace}
                  disabled={submitting}
                  className="btn-secondary flex-1 text-xs py-2"
                >
                  <Sparkles className="w-3.5 h-3.5 text-violet-400" />
                  <span>1-Click Demo Sandbox</span>
                </button>
              </div>
            </div>
          )}

          <div className="mt-5 text-center text-xs text-[var(--text-secondary)]">
            {activeMode === "login" ? (
              <>
                New to EduSMS?{" "}
                <Link to="/register" className="text-violet-400 font-semibold hover:underline">
                  Create an account
                </Link>
              </>
            ) : (
              <>
                Already have an account?{" "}
                <Link to="/login" className="text-violet-400 font-semibold hover:underline">
                  Sign in
                </Link>
              </>
            )}
          </div>
        </div>
      </div>

      <footer className="max-w-5xl w-full mx-auto flex flex-col sm:flex-row items-center justify-between gap-2 text-[11px] text-[var(--text-muted)]">
        <div className="flex items-center gap-1.5">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
          <span>Honest carrier status reporting · Explicit consent enforcement · Zero SIM spoofing</span>
        </div>
        <div className="flex items-center gap-3">
          <a href="/api/v1/docs/" target="_blank" rel="noreferrer" className="hover:underline">
            OpenAPI Swagger
          </a>
          <a href="/api/v1/redoc/" target="_blank" rel="noreferrer" className="hover:underline">
            ReDoc
          </a>
        </div>
      </footer>
    </div>
  );
}
