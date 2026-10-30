import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { installFetchMock, mockJsonResponse, renderAppRoute } from "./helpers";

describe("Overview Dashboard Telemetry, Honest Statuses & Quick Mode Switch", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("renders analytics overview, pending human approval banner, honest status breakdown, and switches automation mode", async () => {
    const user = userEvent.setup();
    let activeModeSlug = "office-hours";

    const { requests } = installFetchMock(({ method, path }) => {
      if (method === "GET" && path === "/api/v1/analytics/overview/") {
        return mockJsonResponse({
          window_days: 14,
          message_summary: {
            real_outbound_total: 42,
            real_outbound_delivered_confirmed: 31,
            real_outbound_submitted: 9,
            real_outbound_queued: 1,
            real_outbound_failed: 1,
            real_inbound_total: 18,
            simulated_outbound: 25,
            simulated_inbound: 20,
            pending_human_approval: 3,
          },
          gateway_summary: {
            paired_devices: 2,
            online_devices: 1,
            sim_ready_devices: 1,
          },
          contacts_summary: {
            total_contacts: 120,
            opted_in_contacts: 112,
            suppressed_or_opted_out: 8,
            groups_count: 4,
          },
          automation_summary: {
            global_automation_enabled: true,
            global_ai_enabled: true,
            active_mode: activeModeSlug === "after-hours" ? "After Hours" : "Office Hours",
            enabled_rules_count: 5,
            auto_replies_sent: 27,
            ai_calls_count: 6,
          },
          timeseries: [
            { date: "2026-01-14", real_outbound: 12, real_inbound: 5, sim_outbound: 10, sim_inbound: 8 },
            { date: "2026-01-15", real_outbound: 30, real_inbound: 13, sim_outbound: 15, sim_inbound: 12 },
          ],
          status_breakdown: [
            { status: "delivered", is_simulation: false, count: 31 },
            { status: "submitted", is_simulation: false, count: 9 },
            { status: "simulated_delivered", is_simulation: true, count: 25 },
          ],
        });
      }
      if (method === "GET" && path === "/api/v1/automation/modes/") {
        return mockJsonResponse([
          {
            id: "mode-1",
            name: "Office Hours",
            slug: "office-hours",
            description: "Weekday office hours",
            is_builtin: true,
            is_active: activeModeSlug === "office-hours",
            response_method: "rules_only",
            response_template: "",
            schedule: null,
            ai_provider: null,
            require_human_approval: false,
            cooldown_minutes: 10,
            updated_at: "2026-01-15T08:00:00Z",
          },
          {
            id: "mode-2",
            name: "After Hours",
            slug: "after-hours",
            description: "Evening auto-responder",
            is_builtin: true,
            is_active: activeModeSlug === "after-hours",
            response_method: "rules_then_template",
            response_template: "We are closed until 08:00.",
            schedule: null,
            ai_provider: null,
            require_human_approval: false,
            cooldown_minutes: 15,
            updated_at: "2026-01-15T08:00:00Z",
          },
        ]);
      }
      if (method === "POST" && path === "/api/v1/automation/modes/mode-2/activate/") {
        activeModeSlug = "after-hours";
        return mockJsonResponse({ status: "activated", mode_id: "mode-2" });
      }
      return null;
    });

    renderAppRoute("/");

    // Heading & Pending Human Approval Banner (await async dashboard fetch completion)
    expect(await screen.findByRole("heading", { name: "Platform Overview" })).toBeInTheDocument();
    const approvalRegion = await screen.findByRole("region", { name: "Pending human approval alert" });
    expect(approvalRegion).toHaveTextContent("3 Automated Replies Awaiting Human Review");

    // Honest carrier vs simulation distinctions
    expect(screen.getByText("Carrier Delivered (Confirmed)")).toBeInTheDocument();
    expect(screen.getByText("Accepted for Transmission (Unconfirmed Delivery)")).toBeInTheDocument();
    expect(screen.getByText("Simulated (No Real SMS)")).toBeInTheDocument();
    expect(screen.getByText("Submitted: 9")).toBeInTheDocument();
    expect(screen.getByText("No Real SMS Sent")).toBeInTheDocument();

    // SVG chart rendered
    expect(screen.getByRole("img", { name: "Daily real and simulated SMS volume chart" })).toBeInTheDocument();

    // Quick Mode Switcher triggers POST /automation/modes/mode-2/activate/
    const afterHoursBtn = screen.getByRole("button", { name: "After Hours" });
    expect(afterHoursBtn).toHaveAttribute("aria-pressed", "false");
    await user.click(afterHoursBtn);

    await waitFor(() => {
      expect(
        requests.some((r) => r.method === "POST" && r.url === "/api/v1/automation/modes/mode-2/activate/")
      ).toBe(true);
    });
    expect(await screen.findByRole("button", { name: "After Hours" })).toHaveAttribute("aria-pressed", "true");
  });
});
