import React from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { ThemeProvider } from "./contexts/ThemeContext";
import { ToastProvider } from "./contexts/ToastContext";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import { RealtimeProvider } from "./contexts/RealtimeContext";
import { AppShell } from "./components/AppShell";
import { LoadingSkeleton } from "./components/States";
import { AuthPage } from "./pages/AuthPage";
import { DashboardPage } from "./pages/DashboardPage";
import { MessagesPage } from "./pages/MessagesPage";
import { SimulationLabPage } from "./pages/SimulationLabPage";
import { ContactsPage } from "./pages/ContactsPage";
import { AutomationPage } from "./pages/AutomationPage";
import { CampaignsPage } from "./pages/CampaignsPage";
import { DevicesPage } from "./pages/DevicesPage";
import { DevelopersPage } from "./pages/DevelopersPage";
import { NotificationsPage } from "./pages/NotificationsPage";
import { SettingsPage } from "./pages/SettingsPage";
import { SupportConsolePage } from "./pages/SupportConsolePage";
import { ServerOpsPage } from "./pages/ServerOpsPage";
import { InstantHelpWidget } from "./components/InstantHelpWidget";

export function ProtectedRoute() {
  const { isAuthenticated, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[var(--bg-canvas)] p-8 flex items-center justify-center">
        <div className="max-w-lg w-full">
          <LoadingSkeleton rows={4} label="Restoring session..." />
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }

  return <AppShell />;
}

export function AppRoutes() {
  return (
    <>
      <Routes>
        {/* Public Auth Routes */}
        <Route path="/login" element={<AuthPage mode="login" />} />
        <Route path="/register" element={<AuthPage mode="register" />} />
        <Route path="/forgot-password" element={<AuthPage mode="forgot" />} />
        <Route path="/reset-password" element={<AuthPage mode="reset" />} />
        <Route path="/verify-email" element={<AuthPage mode="verify" />} />

        {/* Protected Workspace Routes */}
        <Route element={<ProtectedRoute />}>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/messages" element={<MessagesPage />} />
          <Route path="/simulation" element={<SimulationLabPage />} />
          <Route path="/contacts" element={<ContactsPage />} />
          <Route path="/automation" element={<AutomationPage />} />
          <Route path="/campaigns" element={<CampaignsPage />} />
          <Route path="/devices" element={<DevicesPage />} />
          <Route path="/developers" element={<DevelopersPage />} />
          <Route path="/support" element={<SupportConsolePage />} />
          <Route path="/server-ops" element={<ServerOpsPage />} />
          <Route path="/notifications" element={<NotificationsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <InstantHelpWidget />
    </>
  );
}

export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <ToastProvider>
        <AuthProvider>
          <RealtimeProvider>{children}</RealtimeProvider>
        </AuthProvider>
      </ToastProvider>
    </ThemeProvider>
  );
}

export function App() {
  return (
    <AppProviders>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </AppProviders>
  );
}

export default App;
