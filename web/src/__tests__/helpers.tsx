import React from "react";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { vi } from "vitest";
import { AppProviders, AppRoutes } from "../App";
import { tokenStore } from "../api/client";
import type { UserProfile } from "../types/api";

export const MOCK_USER: UserProfile = {
  id: "usr-001",
  email: "instructor@uni.ac.tz",
  full_name: "Dr. Amina Mwakasege",
  organization: "University ICT Lab",
  timezone: "Africa/Dar_es_Salaam",
  default_country_code: "TZ",
  email_verified: true,
  mfa_enabled: false,
  onboarding_completed: true,
  global_automation_enabled: true,
  global_ai_enabled: true,
  theme_preference: "dark",
  default_execution_mode: "simulation",
  require_consent_for_campaigns: true,
  store_inbound_message_body: true,
  message_retention_days: 90,
  daily_real_sms_limit: 500,
  created_at: "2026-01-10T08:00:00Z",
};

export interface RecordedRequest {
  method: string;
  url: string;
  body: unknown;
}

export type RouteHandler = (req: {
  method: string;
  url: URL;
  body: unknown;
}) => { status?: number; data: unknown } | unknown;

export function mockJsonResponse(data: unknown, status = 200): Response {
  return new Response(status === 204 ? null : JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function installFetchMock(
  customHandler?: (req: { method: string; path: string; url: URL; body: unknown }) => Response | null | undefined,
  options?: { user?: UserProfile | null }
) {
  const requests: RecordedRequest[] = [];
  const activeUser = options?.user === undefined ? MOCK_USER : options.user;

  const fetchSpy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const rawUrl = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const url = new URL(rawUrl, "http://localhost:5173");
    const method = (init?.method || "GET").toUpperCase();
    let parsedBody: unknown = undefined;
    if (typeof init?.body === "string" && init.body.length > 0) {
      try {
        parsedBody = JSON.parse(init.body);
      } catch {
        parsedBody = init.body;
      }
    }

    requests.push({ method, url: url.pathname + url.search, body: parsedBody });

    if (customHandler) {
      const customResp = customHandler({ method, path: url.pathname, url, body: parsedBody });
      if (customResp) {
        return customResp;
      }
    }

    // Default baseline mocks for AppShell & AuthProvider
    if (method === "GET" && url.pathname === "/api/v1/auth/me/") {
      if (!activeUser) {
        return mockJsonResponse({ error: { code: "not_authenticated", message: "Not authenticated" } }, 401);
      }
      return mockJsonResponse(activeUser);
    }
    if (method === "GET" && url.pathname === "/api/v1/devices/") {
      return mockJsonResponse([]);
    }
    if (method === "GET" && url.pathname === "/api/v1/automation/modes/") {
      return mockJsonResponse([
        {
          id: "mode-default",
          name: "Office Hours",
          slug: "office-hours",
          description: "Standard keyword rules",
          is_builtin: true,
          is_active: true,
          response_method: "rules_only",
          response_template: "",
          schedule: null,
          ai_provider: null,
          require_human_approval: false,
          cooldown_minutes: 10,
          updated_at: "2026-01-10T08:00:00Z",
        },
      ]);
    }
    if (method === "GET" && url.pathname === "/api/v1/notifications/") {
      return mockJsonResponse([]);
    }

    return mockJsonResponse([]);
  });

  vi.stubGlobal("fetch", fetchSpy);
  return { fetchSpy, requests };
}

export function renderAppRoute(
  initialEntry = "/",
  options?: { authenticated?: boolean }
) {
  const authenticated = options?.authenticated ?? true;
  if (authenticated) {
    tokenStore.setTokens({
      access: "test-access-jwt",
      refresh: "test-refresh-jwt",
      session_id: "sess-001",
    });
  } else {
    tokenStore.clear();
  }

  return render(
    <AppProviders>
      <MemoryRouter initialEntries={[initialEntry]}>
        <AppRoutes />
      </MemoryRouter>
    </AppProviders>
  );
}
