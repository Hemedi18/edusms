import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { installFetchMock, mockJsonResponse, renderAppRoute } from "./helpers";

describe("Campaign Builder Audience Preview & Developer Platform Security Flows", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("previews bulk campaign audience deduplication, eligible recipients, and opt-out exclusions", async () => {
    const user = userEvent.setup();
    installFetchMock(({ method, path }) => {
      if (method === "GET" && path === "/api/v1/campaigns/") return mockJsonResponse([]);
      if (method === "GET" && path === "/api/v1/groups/") {
        return mockJsonResponse([
          {
            id: "grp-cs",
            name: "CS202 Cohort",
            description: "",
            color: "#06B6D4",
            allow_outgoing: true,
            allow_auto_reply: true,
            allow_ai_reply: true,
            assigned_mode: null,
            cooldown_minutes: 10,
            quiet_hours_start: null,
            quiet_hours_end: null,
            member_count: 18,
            created_at: "2026-01-10T08:00:00Z",
          },
        ]);
      }
      if (method === "GET" && path === "/api/v1/sender-identities/") return mockJsonResponse([]);
      if (method === "POST" && path === "/api/v1/campaigns/preview-audience/") {
        return mockJsonResponse({
          total_input_count: 21,
          duplicate_removed_count: 2,
          eligible_count: 17,
          excluded_count: 2,
          volume_cap_exceeded: false,
          max_volume: 500,
          sample_preview: "Hello Amina, reminder that tomorrow's lecture starts at 09:00 in Hall A.",
          eligible_preview: [{ phone_number: "+255754100201", name: "Amina" }],
          excluded_preview: [
            { phone_number: "+255784999000", reason: "Recipient opted out via STOP keyword" },
            { phone_number: "+255711000888", reason: "Number on manual suppression list" },
          ],
        });
      }
      return null;
    });

    renderAppRoute("/campaigns");

    expect(await screen.findByRole("heading", { name: "Bulk Campaigns & Sender Identities" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /New Bulk Campaign/i }));

    const dialog = document.querySelector("dialog")!;
    await user.click(within(dialog).getByRole("button", { name: /Preview Audience & Exclusions/i }));

    const previewRegion = await within(dialog).findByRole("region", { name: "Audience preview summary" });
    expect(previewRegion).toHaveTextContent("21");
    expect(previewRegion).toHaveTextContent("17");
    expect(previewRegion).toHaveTextContent("Recipient opted out via STOP keyword");
    expect(previewRegion).toHaveTextContent("Number on manual suppression list");
    expect(previewRegion).toHaveTextContent(
      "Hello Amina, reminder that tomorrow's lecture starts at 09:00 in Hall A."
    );
  });

  it("reveals one-time raw API key secret in dedicated modal on creation and retries failed webhook deliveries", async () => {
    const user = userEvent.setup();
    const { requests } = installFetchMock(({ method, path }) => {
      if (method === "GET" && path === "/api/v1/developers/api-keys/") {
        return mockJsonResponse([]);
      }
      if (method === "GET" && path === "/api/v1/developers/api-keys/capabilities/") {
        return mockJsonResponse({
          supported_scopes: ["messages:read", "messages:write", "simulation:write"],
          supported_webhook_events: ["sms.received", "sms.delivered", "sms.failed"],
        });
      }
      if (method === "POST" && path === "/api/v1/developers/api-keys/") {
        return mockJsonResponse(
          {
            id: "key-1",
            name: "CI / Backend Integration",
            key_prefix: "edusms_sim_ab12",
            raw_key: "edusms_sim_ab12_SUPER_SECRET_ONE_TIME_VALUE",
            scopes: ["messages:read", "messages:write", "simulation:write"],
            simulation_only: true,
            rate_limit_per_minute: 60,
            expires_at: null,
            revoked_at: null,
            last_used_at: null,
            last_used_ip: null,
            is_active_key: true,
            created_at: "2026-01-15T12:00:00Z",
          },
          201
        );
      }
      if (method === "GET" && path === "/api/v1/developers/webhooks/") {
        return mockJsonResponse([
          {
            id: "wh-1",
            name: "Student Portal Hook",
            url: "https://hooks.uni.ac.tz/edusms",
            is_active: true,
            events: ["sms.received"],
            include_simulation_events: true,
            masked_signing_secret: "whsec_...77ff",
            timeout_seconds: 8,
            consecutive_failures: 1,
            last_triggered_at: "2026-01-15T11:55:00Z",
            last_status_code: 502,
            created_at: "2026-01-10T10:00:00Z",
          },
        ]);
      }
      if (method === "GET" && path === "/api/v1/developers/webhook-deliveries/") {
        return mockJsonResponse([
          {
            id: "deliv-99",
            endpoint: "wh-1",
            endpoint_name: "Student Portal Hook",
            event_uid: "evt_99_failed",
            event_type: "sms.received",
            is_simulation: true,
            payload: { id: "evt_99_failed", type: "sms.received" },
            status: "retrying",
            attempt_count: 1,
            max_attempts: 4,
            next_retry_at: "2026-01-15T12:05:00Z",
            delivered_at: null,
            last_error: "HTTP 502 Bad Gateway",
            attempts: [],
            created_at: "2026-01-15T11:55:00Z",
          },
        ]);
      }
      if (method === "POST" && path === "/api/v1/developers/webhook-deliveries/deliv-99/retry/") {
        return mockJsonResponse({ status: "retried", delivery_id: "deliv-99" });
      }
      return null;
    });

    renderAppRoute("/developers");

    // 1. Create Scoped API Key -> One-time raw key modal opens
    expect(await screen.findByRole("heading", { name: /Developer Platform, Webhooks/i })).toBeInTheDocument();
    const createKeyBtn = await screen.findByRole("button", { name: /Create API Key/i });
    await user.click(createKeyBtn);

    const createDialog = document.querySelector("dialog")!;
    await user.click(within(createDialog).getByRole("button", { name: "Generate Key" }));

    const secretEl = await screen.findByTestId("one-time-raw-secret");
    expect(secretEl).toHaveTextContent("edusms_sim_ab12_SUPER_SECRET_ONE_TIME_VALUE");

    // Dismiss one-time secret modal
    await user.click(screen.getByRole("button", { name: /I Have Saved This Secret/i }));
    expect(screen.queryByTestId("one-time-raw-secret")).not.toBeInTheDocument();

    // 2. Switch to Webhooks & Logs tab and retry failed webhook delivery
    await user.click(screen.getByRole("button", { name: /Webhooks & Logs/i }));
    expect(await screen.findByText(/evt_99_failed/)).toBeInTheDocument();
    expect(screen.getByText(/HTTP 502 Bad Gateway/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Retry Delivery" }));

    await waitFor(() => {
      expect(
        requests.some(
          (r) => r.method === "POST" && r.url === "/api/v1/developers/webhook-deliveries/deliv-99/retry/"
        )
      ).toBe(true);
    });
  });
});
