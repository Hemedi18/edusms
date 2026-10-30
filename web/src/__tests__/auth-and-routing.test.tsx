import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { installFetchMock, MOCK_USER, mockJsonResponse, renderAppRoute } from "./helpers";

const MOCK_OVERVIEW = {
  window_days: 14,
  message_summary: {
    real_outbound_total: 10,
    real_outbound_delivered_confirmed: 7,
    real_outbound_submitted: 2,
    real_outbound_queued: 1,
    real_outbound_failed: 0,
    real_inbound_total: 4,
    simulated_outbound: 15,
    simulated_inbound: 12,
    pending_human_approval: 0,
  },
  gateway_summary: {
    paired_devices: 1,
    online_devices: 1,
    sim_ready_devices: 1,
  },
  contacts_summary: {
    total_contacts: 25,
    opted_in_contacts: 22,
    suppressed_or_opted_out: 3,
    groups_count: 2,
  },
  automation_summary: {
    global_automation_enabled: true,
    global_ai_enabled: true,
    active_mode: "Office Hours",
    enabled_rules_count: 3,
    auto_replies_sent: 9,
    ai_calls_count: 2,
  },
  timeseries: [{ date: "2026-01-15", real_outbound: 5, real_inbound: 2, sim_outbound: 8, sim_inbound: 6 }],
  status_breakdown: [],
};

describe("Authentication Flows & Protected Routing", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("redirects unauthenticated visitors from protected routes to /login", async () => {
    installFetchMock(undefined, { user: null });
    renderAppRoute("/contacts", { authenticated: false });

    expect(await screen.findByRole("heading", { name: "Sign in to EduSMS" })).toBeInTheDocument();
    expect(screen.queryByText("Contacts, Groups & Consent Policy")).not.toBeInTheDocument();
  });

  it("validates minimum 10-character password requirement on registration before calling API", async () => {
    const user = userEvent.setup();
    const { requests } = installFetchMock(undefined, { user: null });
    renderAppRoute("/register", { authenticated: false });

    expect(await screen.findByRole("heading", { name: "Create your EduSMS account" })).toBeInTheDocument();

    await user.type(screen.getByLabelText("Full Name"), "Dr. Juma");
    await user.type(screen.getByLabelText("Email Address"), "juma@uni.ac.tz");
    await user.type(screen.getByLabelText(/Password/), "short123");
    await user.click(screen.getByRole("button", { name: /Create Account/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Password must be at least 10 characters long.");
    expect(requests.some((r) => r.url.includes("/auth/register/"))).toBe(false);
  });

  it("handles MFA-protected login challenge and navigates to Overview Dashboard on success", async () => {
    const user = userEvent.setup();
    const { requests } = installFetchMock(({ method, path, body }) => {
      if (method === "POST" && path === "/api/v1/auth/login/") {
        const payload = body as { email: string; password: string; mfa_code?: string };
        if (!payload.mfa_code) {
          return mockJsonResponse(
            {
              error: {
                code: "validation_error",
                message: "MFA code required.",
                details: { mfa_required: "Authenticator code required." },
              },
            },
            400
          );
        }
        return mockJsonResponse({
          access: "jwt-access-token",
          refresh: "jwt-refresh-token",
          session_id: "sess-123",
          user: MOCK_USER,
        });
      }
      if (method === "GET" && path === "/api/v1/analytics/overview/") {
        return mockJsonResponse(MOCK_OVERVIEW);
      }
      return null;
    });

    renderAppRoute("/login", { authenticated: false });

    await user.type(await screen.findByLabelText("Email Address"), "instructor@uni.ac.tz");
    await user.type(screen.getByLabelText("Password"), "EduSMSDemo!2026");
    await user.click(screen.getByRole("button", { name: /^Sign In$/i }));

    // MFA challenge prompt appears
    expect(await screen.findByRole("alert")).toHaveTextContent(/6-digit authenticator code/i);
    const mfaInput = screen.getByLabelText("Authenticator / Recovery Code");
    await user.type(mfaInput, "654321");
    await user.click(screen.getByRole("button", { name: /^Sign In$/i }));

    // Lands on Overview Dashboard
    expect(await screen.findByRole("heading", { name: "Platform Overview" })).toBeInTheDocument();
    await waitFor(() => {
      const loginCalls = requests.filter((r) => r.method === "POST" && r.url === "/api/v1/auth/login/");
      expect(loginCalls).toHaveLength(2);
      expect((loginCalls[1].body as { mfa_code?: string }).mfa_code).toBe("654321");
    });
  });
});
