import React, { useCallback, useEffect, useState } from "react";
import {
  Server,
  GitBranch,
  RefreshCw,
  Copy,
  Check,
  Globe,
  Mail,
  ShieldCheck,
  Terminal,
  UploadCloud,
  DownloadCloud,
} from "lucide-react";
import { api } from "../api/client";
import { useToast } from "../contexts/ToastContext";

interface GitStatusInfo {
  initialized: boolean;
  branch: string;
  commit_sha: string;
  last_commit_message: string;
  last_commit_date: string;
  remote_url: string;
  working_tree_clean: boolean;
  modified_files_count: number;
  last_sync_at: string | null;
  last_sync_status: string;
  last_sync_output: string;
}

interface CpanelSummaryInfo {
  primary_domain: string;
  target_subdomain: string;
  cpanel_host: string;
  cpanel_username: string;
  credentials_configured: boolean;
  mcp_bridge_configured: boolean;
  mcp_endpoint: string;
  document_root: string;
  passenger_wsgi_ready: boolean;
  email_accounts: Array<{
    email: string;
    purpose: string;
    smtp_host: string;
    smtp_port: number;
    status: string;
  }>;
  quota: {
    megabyte_limit: number;
    megabytes_used: number;
    inodes_used: number;
  };
}

const SERVER_COMMANDS = [
  {
    id: "start-local-all",
    title: "1. Start Local PostgreSQL, Redis & Django ASGI Server",
    description: "Starts local database/cache daemons, runs migrations, and launches Daphne on port 8000.",
    command: `bash scripts/dev_services.sh start
backend/.venv/bin/python backend/manage.py migrate
backend/.venv/bin/daphne -b 0.0.0.0 -p 8000 --chdir backend edusms.asgi:application`,
  },
  {
    id: "start-web-dev",
    title: "2. Start React Web Dashboard",
    description: "Launches the Vite web server on http://localhost:5173 (or builds static dist/ for cPanel).",
    command: `npm --prefix web run dev`,
  },
  {
    id: "start-celery",
    title: "3. Start Celery Worker & Campaign Scheduler",
    description: "Processes throttled bulk SMS campaigns, scheduled jobs, and webhook deliveries.",
    command: `backend/.venv/bin/celery --workdir backend -A edusms worker -l info
backend/.venv/bin/celery --workdir backend -A edusms beat -l info`,
  },
  {
    id: "docker-up",
    title: "4. Launch Full Stack via Docker Compose",
    description: "Builds and starts PostgreSQL, Redis, Django ASGI, Celery Worker/Beat, and Web Dashboard.",
    command: `cp .env.example .env
docker compose up --build -d
docker compose exec backend python manage.py migrate`,
  },
  {
    id: "github-init-push",
    title: "5. Initialize & Push Codebase to GitHub (Hemedi18/edusms)",
    description: "Links the repository to https://github.com/Hemedi18/edusms.git on branch main and pushes.",
    command: `echo "# edusms" >> README.md
git init
git add .
git commit -m "first commit"
git branch -M main
git remote add origin https://github.com/Hemedi18/edusms.git
git push -u origin main`,
  },
  {
    id: "github-pull-sync",
    title: "6. Pull Latest Changes from GitHub & Migrate",
    description: "Fetches and fast-forward merges updates from origin/main and applies any new migrations.",
    command: `git fetch origin main
git pull --ff-only origin main
backend/.venv/bin/python backend/manage.py migrate --noinput
npm --prefix web run build`,
  },
  {
    id: "cpanel-deploy",
    title: "7. cPanel Subdomain (edusms.edusphere.co.tz) & Passenger Deployment",
    description: "Clones/updates the project inside cPanel public_html/edusms and restarts Phusion Passenger.",
    command: `mkdir -p ~/public_html/edusms
cd ~/public_html/edusms
git clone https://github.com/Hemedi18/edusms.git . || git pull origin main
python3 -m venv backend/.venv
backend/.venv/bin/pip install -r backend/requirements.txt
backend/.venv/bin/python backend/manage.py migrate --noinput
backend/.venv/bin/python backend/manage.py collectstatic --noinput
mkdir -p tmp && touch tmp/restart.txt`,
  },
];

export function ServerOpsPage() {
  const toast = useToast();

  const [gitStatus, setGitStatus] = useState<GitStatusInfo | null>(null);
  const [cpanelSummary, setCpanelSummary] = useState<CpanelSummaryInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncingGit, setSyncingGit] = useState(false);
  const [provisioningCpanel, setProvisioningCpanel] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // cPanel & Email provisioning form
  const [cpanelHost, setCpanelHost] = useState("https://edusphere.co.tz:2083");
  const [cpanelUsername, setCpanelUsername] = useState("");
  const [cpanelApiToken, setCpanelApiToken] = useState("");
  const [subdomainPrefix, setSubdomainPrefix] = useState("edusms");
  const [rootDomain, setRootDomain] = useState("edusphere.co.tz");
  const [supportEmailUser, setSupportEmailUser] = useState("support");
  const [supportEmailPassword, setSupportEmailPassword] = useState("");
  const [adminAlertEmail, setAdminAlertEmail] = useState("support@edusms.edusphere.co.tz");
  const [githubPat, setGithubPat] = useState("");

  const fetchOpsStatus = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<{
        config: Record<string, unknown>;
        cpanel_summary: CpanelSummaryInfo;
        git_status: GitStatusInfo;
      }>("/ops/status/");
      setCpanelSummary(res.cpanel_summary);
      setGitStatus(res.git_status);
      if (res.config?.cpanel_host) setCpanelHost(String(res.config.cpanel_host));
      if (res.config?.cpanel_username) setCpanelUsername(String(res.config.cpanel_username));
      if (res.config?.admin_alert_email) setAdminAlertEmail(String(res.config.admin_alert_email));
    } catch {
      // ignore initial error
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchOpsStatus();
  }, [fetchOpsStatus]);

  const handleCopyCommand = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Fallback for environments without clipboard API
    }
    setCopiedId(id);
    toast.success("Command copied to clipboard!");
    setTimeout(() => {
      setCopiedId((prev) => (prev === id ? null : prev));
    }, 2000);
  };

  const handleGitSync = async (action: "pull" | "push") => {
    setSyncingGit(true);
    try {
      const res = await api.post<{
        status: string;
        output: string;
        git_status: GitStatusInfo;
      }>("/ops/git-sync/", {
        action,
        branch: "main",
        github_pat: githubPat.trim() || undefined,
      });
      setGitStatus(res.git_status);
      toast.success(
        action === "pull"
          ? "Project synchronized with GitHub (origin/main)!"
          : "Git push command executed!"
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Git sync failed");
    } finally {
      setSyncingGit(false);
    }
  };

  const handleProvisionCpanel = async (e: React.FormEvent) => {
    e.preventDefault();
    setProvisioningCpanel(true);
    try {
      const res = await api.post<{
        subdomain: string;
        support_email: string;
        summary: CpanelSummaryInfo;
      }>("/ops/cpanel/provision/", {
        cpanel_host: cpanelHost,
        cpanel_username: cpanelUsername,
        cpanel_api_token: cpanelApiToken,
        subdomain_prefix: subdomainPrefix,
        root_domain: rootDomain,
        support_email_user: supportEmailUser,
        support_email_password: supportEmailPassword,
        admin_alert_email: adminAlertEmail,
      });
      setCpanelSummary(res.summary);
      toast.success(`cPanel Subdomain (${res.subdomain}) & Support Email (${res.support_email}) configured!`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update cPanel configuration");
    } finally {
      setProvisioningCpanel(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-[var(--text-primary)] flex items-center gap-2">
            <Server className="w-5 h-5 text-violet-400" />
            <span>cPanel Hosting (`edusms.edusphere.co.tz`), GitHub Auto-Sync & Server Commands</span>
          </h1>
          <p className="text-xs text-[var(--text-secondary)]">
            One-click GitHub synchronization with `Hemedi18/edusms`, cPanel subdomain & email provisioning, and
            copy-paste server startup commands.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            data-testid="github-sync-btn"
            disabled={syncingGit}
            onClick={() => void handleGitSync("pull")}
            className="btn-primary text-xs py-2 px-4 flex items-center gap-2 shadow-lg shadow-violet-600/25"
          >
            <DownloadCloud className={`w-4 h-4 ${syncingGit ? "animate-bounce" : ""}`} />
            <span>{syncingGit ? "Syncing with GitHub..." : "Sync from GitHub Now (Pull Latest)"}</span>
          </button>
          <button
            type="button"
            disabled={syncingGit}
            onClick={() => void handleGitSync("push")}
            className="btn-secondary text-xs py-2 px-3 flex items-center gap-1.5"
          >
            <UploadCloud className="w-4 h-4 text-cyan-400" />
            <span>Push to GitHub</span>
          </button>
        </div>
      </div>

      {/* Top Row: GitHub Auto-Sync Card + cPanel Account Summary Card */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* GitHub Repository & Auto-Sync Status */}
        <div className="surface-card p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-violet-500/15 text-violet-400 flex items-center justify-center">
                <GitBranch className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-sm font-bold text-[var(--text-primary)]">
                  GitHub Auto-Sync (`Hemedi18/edusms`)
                </h2>
                <p className="text-xs text-[var(--text-secondary)]">
                  Remote:{" "}
                  <code className="font-mono text-violet-400">
                    {gitStatus?.remote_url || "https://github.com/Hemedi18/edusms.git"}
                  </code>
                </p>
              </div>
            </div>
            <span className="px-2.5 py-1 rounded-full bg-emerald-500/15 text-emerald-400 text-xs font-semibold">
              Branch: {gitStatus?.branch || "main"}
            </span>
          </div>

          <div className="grid grid-cols-3 gap-3 text-xs">
            <div className="p-3 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)]">
              <p className="text-[10px] text-[var(--text-muted)]">Current Commit</p>
              <p className="font-mono font-bold text-[var(--text-primary)] mt-0.5">
                {gitStatus?.commit_sha || "HEAD"}
              </p>
            </div>
            <div className="p-3 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)]">
              <p className="text-[10px] text-[var(--text-muted)]">Working Tree</p>
              <p className="font-bold text-emerald-400 mt-0.5">
                {gitStatus?.working_tree_clean ? "Clean" : `${gitStatus?.modified_files_count || 0} modified`}
              </p>
            </div>
            <div className="p-3 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)]">
              <p className="text-[10px] text-[var(--text-muted)]">Webhook Endpoint</p>
              <p className="font-mono text-[11px] text-cyan-400 mt-0.5 truncate">/api/v1/ops/github-webhook/</p>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
              Optional GitHub Personal Access Token (for private repo push/pull on server)
            </label>
            <input
              type="password"
              value={githubPat}
              onChange={(e) => setGithubPat(e.target.value)}
              placeholder="ghp_... (stored encrypted with HKDF-Fernet if provided)"
              className="input-field text-xs font-mono"
            />
          </div>

          {gitStatus?.last_sync_output && (
            <div className="space-y-1">
              <p className="text-xs font-semibold text-[var(--text-secondary)]">Latest Git Sync Output:</p>
              <pre className="p-3 rounded-xl bg-black/50 border border-[var(--border-subtle)] text-[11px] font-mono text-emerald-300 overflow-x-auto max-h-40">
                {gitStatus.last_sync_output}
              </pre>
            </div>
          )}
        </div>

        {/* cPanel Account & Domain Summary (`edusms.edusphere.co.tz`) */}
        <div className="surface-card p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-cyan-500/15 text-cyan-400 flex items-center justify-center">
                <Globe className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-sm font-bold text-[var(--text-primary)]">
                  cPanel Summary (`{cpanelSummary?.target_subdomain || "edusms.edusphere.co.tz"}`)
                </h2>
                <p className="text-xs text-[var(--text-secondary)]">
                  Primary Domain: <strong>{cpanelSummary?.primary_domain || "edusphere.co.tz"}</strong> • WebPros MCP Ready
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => void fetchOpsStatus()}
              className="btn-secondary p-2 text-xs"
              title="Refresh cPanel summary"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3 text-xs">
            <div className="p-3 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)]">
              <p className="text-[10px] text-[var(--text-muted)]">Live Subdomain URL</p>
              <p className="font-mono font-bold text-cyan-400 mt-0.5">
                https://{cpanelSummary?.target_subdomain || "edusms.edusphere.co.tz"}
              </p>
            </div>
            <div className="p-3 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)]">
              <p className="text-[10px] text-[var(--text-muted)]">Passenger WSGI & Root</p>
              <p className="font-mono text-[11px] text-[var(--text-primary)] mt-0.5 truncate">
                {cpanelSummary?.document_root || "/home/eduspher/public_html/edusms"}
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-xs font-semibold text-[var(--text-secondary)] flex items-center gap-1.5">
              <Mail className="w-3.5 h-3.5 text-violet-400" />
              <span>Configured Email Accounts (Password Verification, Auto Error Alerts & Live Chat Bridge)</span>
            </p>
            <div className="space-y-2">
              {(cpanelSummary?.email_accounts || []).map((em, idx) => (
                <div
                  key={idx}
                  className="p-2.5 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] flex items-center justify-between text-xs"
                >
                  <div>
                    <p className="font-mono font-bold text-[var(--text-primary)]">{em.email}</p>
                    <p className="text-[11px] text-[var(--text-secondary)]">{em.purpose}</p>
                  </div>
                  <span className="px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-400 text-[10px] font-semibold flex items-center gap-1">
                    <ShieldCheck className="w-3 h-3" /> {em.status}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* cPanel Subdomain & Support Email Provisioning Form */}
      <form onSubmit={handleProvisionCpanel} className="surface-card p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-[var(--border-subtle)] pb-3">
          <div>
            <h2 className="text-sm font-bold text-[var(--text-primary)]">
              Configure & Provision cPanel Subdomain (`edusms.edusphere.co.tz`) + Support Email
            </h2>
            <p className="text-xs text-[var(--text-secondary)]">
              Connects to cPanel UAPI (`SubDomain::addsubdomain`, `Email::add_pop`, `SSL::start_autossl_check`) and
              configures SMTP for password verification, automatic error emails, and live chat email replies.
            </p>
          </div>
          <button type="submit" disabled={provisioningCpanel} className="btn-primary text-xs py-2 px-4 shrink-0">
            {provisioningCpanel ? "Provisioning..." : "Save & Provision on cPanel"}
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
          <div>
            <label className="block text-[var(--text-secondary)] mb-1">cPanel Host URL</label>
            <input
              type="text"
              value={cpanelHost}
              onChange={(e) => setCpanelHost(e.target.value)}
              className="input-field font-mono text-xs"
            />
          </div>
          <div>
            <label className="block text-[var(--text-secondary)] mb-1">cPanel Username</label>
            <input
              type="text"
              value={cpanelUsername}
              onChange={(e) => setCpanelUsername(e.target.value)}
              placeholder="e.g. eduspher"
              className="input-field font-mono text-xs"
            />
          </div>
          <div>
            <label className="block text-[var(--text-secondary)] mb-1">cPanel UAPI Token</label>
            <input
              type="password"
              value={cpanelApiToken}
              onChange={(e) => setCpanelApiToken(e.target.value)}
              placeholder="cPanel Security -> Manage API Tokens"
              className="input-field font-mono text-xs"
            />
          </div>
          <div>
            <label className="block text-[var(--text-secondary)] mb-1">Subdomain & Root Domain</label>
            <div className="flex items-center gap-1">
              <input
                type="text"
                value={subdomainPrefix}
                onChange={(e) => setSubdomainPrefix(e.target.value)}
                className="input-field font-mono text-xs w-24"
              />
              <span className="text-[var(--text-muted)]">.</span>
              <input
                type="text"
                value={rootDomain}
                onChange={(e) => setRootDomain(e.target.value)}
                className="input-field font-mono text-xs flex-1"
              />
            </div>
          </div>
          <div>
            <label className="block text-[var(--text-secondary)] mb-1">Support Mailbox Prefix</label>
            <input
              type="text"
              value={supportEmailUser}
              onChange={(e) => setSupportEmailUser(e.target.value)}
              className="input-field font-mono text-xs"
            />
          </div>
          <div>
            <label className="block text-[var(--text-secondary)] mb-1">Mailbox / SMTP Password</label>
            <input
              type="password"
              value={supportEmailPassword}
              onChange={(e) => setSupportEmailPassword(e.target.value)}
              placeholder="Password for support@edusms.edusphere.co.tz"
              className="input-field font-mono text-xs"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="block text-[var(--text-secondary)] mb-1">
              Owner Alert Email (Receives Immediate Error Reports & First-Time Live Chat Messages)
            </label>
            <input
              type="email"
              value={adminAlertEmail}
              onChange={(e) => setAdminAlertEmail(e.target.value)}
              className="input-field font-mono text-xs"
            />
          </div>
        </div>
      </form>

      {/* Copy-Paste Server Startup & Deployment Command Guide */}
      <div className="surface-card p-5 space-y-4">
        <div className="flex items-center gap-2 border-b border-[var(--border-subtle)] pb-3">
          <Terminal className="w-5 h-5 text-cyan-400" />
          <div>
            <h2 className="text-sm font-bold text-[var(--text-primary)]">
              Server Startup, GitHub Sync & cPanel Deployment Command Reference
            </h2>
            <p className="text-xs text-[var(--text-secondary)]">
              Click <strong>Copy Command</strong> on any card below to copy and paste directly into your terminal.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {SERVER_COMMANDS.map((item) => {
            const isCopied = copiedId === item.id;
            return (
              <div
                key={item.id}
                className="p-4 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] flex flex-col justify-between space-y-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="text-xs font-bold text-[var(--text-primary)]">{item.title}</h3>
                    <p className="text-[11px] text-[var(--text-secondary)] mt-0.5">{item.description}</p>
                  </div>
                  <button
                    type="button"
                    data-testid={`copy-cmd-${item.id}`}
                    onClick={() => void handleCopyCommand(item.id, item.command)}
                    className="btn-secondary py-1.5 px-2.5 text-[11px] flex items-center gap-1.5 shrink-0"
                  >
                    {isCopied ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                        <span className="text-emerald-400">Copied!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5 text-violet-400" />
                        <span>Copy Command</span>
                      </>
                    )}
                  </button>
                </div>
                <pre className="p-3 rounded-lg bg-black/50 border border-[var(--border-subtle)] text-[11px] font-mono text-cyan-300 overflow-x-auto">
                  {item.command}
                </pre>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
