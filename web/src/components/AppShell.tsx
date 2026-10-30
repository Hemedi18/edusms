import React, { useCallback, useEffect, useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  MessageSquareText,
  FlaskConical,
  Users,
  Bot,
  Megaphone,
  Smartphone,
  Code2,
  Bell,
  Settings,
  Sun,
  Moon,
  Monitor,
  Menu,
  X,
  PanelLeftClose,
  PanelLeftOpen,
  LogOut,
  Sparkles,
  Wifi,
  WifiOff,
  Compass,
  Headset,
  Server,
} from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import { useTheme } from "../contexts/ThemeContext";
import { useRealtime, useRealtimeEvent } from "../contexts/RealtimeContext";
import { api, unwrapList } from "../api/client";
import type { AutomationModeRecord, DeviceRecord, NotificationRecord, ThemeMode } from "../types/api";
import { OnboardingModal } from "./OnboardingModal";

const NAV_ITEMS = [
  { to: "/", label: "Overview", icon: LayoutDashboard, end: true },
  { to: "/messages", label: "Messages", icon: MessageSquareText },
  { to: "/simulation", label: "Simulation Lab", icon: FlaskConical },
  { to: "/contacts", label: "Contacts & Consent", icon: Users },
  { to: "/automation", label: "Automation & AI", icon: Bot },
  { to: "/campaigns", label: "Campaigns & Senders", icon: Megaphone },
  { to: "/devices", label: "SIM Gateways", icon: Smartphone },
  { to: "/developers", label: "Developer API", icon: Code2 },
  { to: "/support", label: "Live Support & Errors", icon: Headset },
  { to: "/server-ops", label: "Server & GitHub Sync", icon: Server },
  { to: "/notifications", label: "Notifications & Audit", icon: Bell },
  { to: "/settings", label: "Account Settings", icon: Settings },
];

export function AppShell() {
  const { user, logout } = useAuth();
  const { themeMode, setThemeMode } = useTheme();
  const { isConnected } = useRealtime();
  const navigate = useNavigate();

  const [collapsed, setCollapsed] = useState(false);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  const [onlineGatewaysCount, setOnlineGatewaysCount] = useState(0);
  const [activeModeName, setActiveModeName] = useState("Default");
  const [unreadCount, setUnreadCount] = useState(0);

  const fetchTopbarSummary = useCallback(async () => {
    try {
      const [devicesRes, modesRes, notifsRes] = await Promise.all([
        api.get<DeviceRecord[] | { results: DeviceRecord[] }>("/devices/").catch(() => []),
        api.get<AutomationModeRecord[] | { results: AutomationModeRecord[] }>("/automation/modes/").catch(() => []),
        api
          .get<NotificationRecord[] | { results: NotificationRecord[] }>("/notifications/?is_read=false")
          .catch(() => []),
      ]);
      const devices = unwrapList<DeviceRecord>(devicesRes as DeviceRecord[]);
      const modes = unwrapList<AutomationModeRecord>(modesRes as AutomationModeRecord[]);
      const unread = unwrapList<NotificationRecord>(notifsRes as NotificationRecord[]);

      setOnlineGatewaysCount(devices.filter((d) => d.is_online && d.is_enabled && !d.is_paused).length);
      const activeMode = modes.find((m) => m.is_active);
      if (activeMode) setActiveModeName(activeMode.name);
      setUnreadCount(unread.filter((n) => !n.is_read).length);
    } catch {
      // ignore background summary error
    }
  }, []);

  useEffect(() => {
    void fetchTopbarSummary();
  }, [fetchTopbarSummary]);

  useEffect(() => {
    if (user && !user.onboarding_completed) {
      setOnboardingOpen(true);
    }
  }, [user]);

  useRealtimeEvent(
    ["device.status", "automation.mode_changed", "notification.created", "message.updated"],
    (msg) => {
      if (msg.event === "automation.mode_changed" && msg.payload.mode_name) {
        setActiveModeName(String(msg.payload.mode_name));
      } else {
        void fetchTopbarSummary();
      }
    }
  );

  const handleLogout = async () => {
    await logout();
    navigate("/login");
  };

  const themeOptions: Array<{ mode: ThemeMode; label: string; Icon: typeof Sun }> = [
    { mode: "dark", label: "Dark", Icon: Moon },
    { mode: "light", label: "Light", Icon: Sun },
    { mode: "system", label: "System", Icon: Monitor },
  ];

  const renderSidebarLinks = (onNavigate?: () => void) => (
    <nav className="flex-1 px-3 py-3 space-y-1 overflow-y-auto" aria-label="Main navigation">
      {NAV_ITEMS.map((item) => {
        const Icon = item.icon;
        return (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            onClick={onNavigate}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition ${
                isActive
                  ? "bg-gradient-to-r from-violet-600/20 to-cyan-500/15 text-[var(--text-primary)] border border-violet-500/40 shadow-sm"
                  : "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] border border-transparent"
              }`
            }
          >
            <Icon className="w-4 h-4 shrink-0 text-violet-400" />
            {(!collapsed || onNavigate) && <span className="truncate">{item.label}</span>}
            {item.to === "/notifications" && unreadCount > 0 && (!collapsed || onNavigate) && (
              <span className="ml-auto px-1.5 py-0.5 text-[11px] font-bold rounded-full bg-violet-600 text-white">
                {unreadCount}
              </span>
            )}
          </NavLink>
        );
      })}
    </nav>
  );

  return (
    <div className="min-h-screen flex bg-[var(--bg-canvas)] text-[var(--text-primary)]">
      {/* Desktop Sidebar */}
      <aside
        className={`hidden lg:flex flex-col shrink-0 border-r border-[var(--border-subtle)] bg-[var(--bg-surface)] transition-all duration-200 ${
          collapsed ? "w-20" : "w-64"
        }`}
      >
        <div className="h-16 px-4 flex items-center justify-between border-b border-[var(--border-subtle)]">
          <div className="flex items-center gap-2.5 overflow-hidden">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-600 to-cyan-500 flex items-center justify-center text-white font-bold shadow-md shrink-0">
              E
            </div>
            {!collapsed && (
              <div className="truncate">
                <div className="text-sm font-bold tracking-tight">EduSMS</div>
                <div className="text-[11px] text-[var(--text-muted)]">SIM Gateway & AI</div>
              </div>
            )}
          </div>
          <button
            type="button"
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            onClick={() => setCollapsed((c) => !c)}
            className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] cursor-pointer"
          >
            {collapsed ? <PanelLeftOpen className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
          </button>
        </div>

        {renderSidebarLinks()}

        {!collapsed && (
          <div className="p-3 border-t border-[var(--border-subtle)]">
            <button
              type="button"
              onClick={() => setOnboardingOpen(true)}
              className="w-full surface-elevated p-2.5 text-left hover:border-violet-500/40 transition flex items-center gap-2.5 cursor-pointer"
            >
              <Compass className="w-4 h-4 text-cyan-400 shrink-0" />
              <div className="min-w-0">
                <div className="text-xs font-semibold text-[var(--text-primary)] truncate">Setup Wizard</div>
                <div className="text-[11px] text-[var(--text-secondary)] truncate">Simulation vs SIM Pairing</div>
              </div>
            </button>
          </div>
        )}
      </aside>

      {/* Mobile Drawer */}
      {mobileDrawerOpen && (
        <div className="fixed inset-0 z-40 lg:hidden flex">
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-xs"
            onClick={() => setMobileDrawerOpen(false)}
          />
          <aside className="relative z-10 w-72 max-w-[85vw] bg-[var(--bg-surface)] border-r border-[var(--border-strong)] flex flex-col">
            <div className="h-16 px-4 flex items-center justify-between border-b border-[var(--border-subtle)]">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-violet-600 to-cyan-500 flex items-center justify-center text-white font-bold">
                  E
                </div>
                <span className="font-bold text-sm">EduSMS</span>
              </div>
              <button
                type="button"
                aria-label="Close navigation menu"
                onClick={() => setMobileDrawerOpen(false)}
                className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            {renderSidebarLinks(() => setMobileDrawerOpen(false))}
          </aside>
        </div>
      )}

      {/* Main Column */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Bar */}
        <header className="h-16 sticky top-0 z-30 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)]/90 backdrop-blur-md px-4 sm:px-6 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <button
              type="button"
              aria-label="Open navigation menu"
              onClick={() => setMobileDrawerOpen(true)}
              className="lg:hidden p-2 rounded-lg text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]"
            >
              <Menu className="w-5 h-5" />
            </button>

            {/* Gateway vs Simulation Status Pill */}
            <button
              type="button"
              onClick={() => navigate(onlineGatewaysCount > 0 ? "/devices" : "/simulation")}
              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border cursor-pointer ${
                onlineGatewaysCount > 0
                  ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/35"
                  : "bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 border-cyan-500/35"
              }`}
            >
              {onlineGatewaysCount > 0 ? (
                <>
                  <Smartphone className="w-3.5 h-3.5" />
                  <span>{onlineGatewaysCount} Android SIM Online</span>
                </>
              ) : (
                <>
                  <FlaskConical className="w-3.5 h-3.5" />
                  <span>Simulation Sandbox Active</span>
                </>
              )}
            </button>

            {/* Active Automation Mode Quick Pill */}
            <button
              type="button"
              onClick={() => navigate("/automation")}
              className="hidden md:inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border bg-violet-500/12 text-violet-700 dark:text-violet-300 border-violet-500/30 cursor-pointer"
              title="Active Automation Mode"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Mode: {activeModeName}</span>
            </button>

            {/* Realtime WS indicator */}
            <span
              title={isConnected ? "Realtime WebSocket connected" : "Realtime WebSocket offline (using REST polling)"}
              className="hidden sm:inline-flex items-center gap-1 text-[11px] text-[var(--text-muted)]"
            >
              {isConnected ? (
                <Wifi className="w-3.5 h-3.5 text-emerald-400" />
              ) : (
                <WifiOff className="w-3.5 h-3.5 text-[var(--text-muted)]" />
              )}
            </span>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            {/* Theme Switcher (Dark / Light / System) */}
            <div
              role="group"
              aria-label="Theme switcher"
              className="inline-flex items-center p-0.5 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-subtle)]"
            >
              {themeOptions.map(({ mode, label, Icon }) => {
                const active = themeMode === mode;
                return (
                  <button
                    key={mode}
                    type="button"
                    aria-label={`${label} theme`}
                    aria-pressed={active}
                    onClick={() => setThemeMode(mode)}
                    className={`p-1.5 rounded-md text-xs font-medium flex items-center gap-1 transition cursor-pointer ${
                      active
                        ? "bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-xs border border-[var(--border-subtle)]"
                        : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    <span className="hidden xl:inline">{label}</span>
                  </button>
                );
              })}
            </div>

            {/* Unread Notifications Bell */}
            <button
              type="button"
              aria-label="Notifications"
              onClick={() => navigate("/notifications")}
              className="relative p-2 rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] cursor-pointer"
            >
              <Bell className="w-4 h-4" />
              {unreadCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 min-w-4 h-4 px-1 rounded-full bg-violet-600 text-white text-[10px] font-bold flex items-center justify-center">
                  {unreadCount > 9 ? "9+" : unreadCount}
                </span>
              )}
            </button>

            {/* User Menu */}
            <div className="relative">
              <button
                type="button"
                aria-label="Account menu"
                onClick={() => setUserMenuOpen((o) => !o)}
                className="flex items-center gap-2 pl-2 pr-2.5 py-1.5 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] hover:border-[var(--border-strong)] cursor-pointer"
              >
                <div className="w-6 h-6 rounded-full bg-violet-600 text-white text-xs font-bold flex items-center justify-center">
                  {(user?.full_name || user?.email || "U").charAt(0).toUpperCase()}
                </div>
                <span className="hidden sm:inline text-xs font-medium max-w-28 truncate">
                  {user?.full_name || user?.email}
                </span>
              </button>

              {userMenuOpen && (
                <div
                  onMouseLeave={() => setUserMenuOpen(false)}
                  className="absolute right-0 mt-2 w-56 surface-card shadow-xl border border-[var(--border-strong)] p-1.5 z-50"
                >
                  <div className="px-3 py-2 border-b border-[var(--border-subtle)]">
                    <div className="text-xs font-semibold text-[var(--text-primary)] truncate">
                      {user?.full_name}
                    </div>
                    <div className="text-[11px] text-[var(--text-muted)] truncate">{user?.email}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setUserMenuOpen(false);
                      setOnboardingOpen(true);
                    }}
                    className="w-full text-left px-3 py-2 text-xs rounded-lg hover:bg-[var(--bg-elevated)] flex items-center gap-2 cursor-pointer"
                  >
                    <Compass className="w-3.5 h-3.5 text-cyan-400" />
                    <span>Launch Setup Wizard</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setUserMenuOpen(false);
                      navigate("/settings");
                    }}
                    className="w-full text-left px-3 py-2 text-xs rounded-lg hover:bg-[var(--bg-elevated)] flex items-center gap-2 cursor-pointer"
                  >
                    <Settings className="w-3.5 h-3.5 text-violet-400" />
                    <span>Account & Security Settings</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setUserMenuOpen(false);
                      void handleLogout();
                    }}
                    className="w-full text-left px-3 py-2 text-xs rounded-lg hover:bg-rose-500/10 text-rose-400 flex items-center gap-2 cursor-pointer"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    <span>Sign Out</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* Page Content */}
        <main className="flex-1 p-4 sm:p-6 lg:p-8 pb-20 lg:pb-8 max-w-7xl w-full mx-auto">
          <Outlet />
        </main>

        {/* Mobile Bottom Quick Bar */}
        <nav
          aria-label="Mobile quick navigation"
          className="lg:hidden fixed bottom-0 inset-x-0 z-30 h-14 bg-[var(--bg-surface)]/95 backdrop-blur-md border-t border-[var(--border-subtle)] grid grid-cols-5"
        >
          {[
            NAV_ITEMS[0],
            NAV_ITEMS[1],
            NAV_ITEMS[2],
            NAV_ITEMS[4],
            NAV_ITEMS[6],
          ].map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium ${
                    isActive ? "text-violet-400" : "text-[var(--text-muted)]"
                  }`
                }
              >
                <Icon className="w-4 h-4" />
                <span className="truncate max-w-16">{item.label.split(" ")[0]}</span>
              </NavLink>
            );
          })}
        </nav>
      </div>

      <OnboardingModal open={onboardingOpen} onClose={() => setOnboardingOpen(false)} />
    </div>
  );
}
