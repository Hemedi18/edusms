import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { installFetchMock, mockJsonResponse, renderAppRoute } from "./helpers";

describe("Simulation Lab & Android SIM Gateway Pairing", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("injects virtual inbound SMS in Simulation Lab and displays auto-reply pipeline evaluation", async () => {
    const user = userEvent.setup();
    const { requests } = installFetchMock(({ method, path }) => {
      if (method === "GET" && path === "/api/v1/messages/") {
        return mockJsonResponse([]);
      }
      if (method === "POST" && path === "/api/v1/simulation/inject-inbound/") {
        return mockJsonResponse({
          inbound_message_id: "msg-in-1",
          decision: "matched_rule",
          reply_message_id: "msg-out-1",
          summary: "Matched rule 'Opening Hours' and queued simulated auto-reply.",
        });
      }
      return null;
    });

    renderAppRoute("/simulation");

    expect(await screen.findByRole("heading", { name: "Simulation Lab" })).toBeInTheDocument();
    expect(screen.getByText("No Real SMS Sent")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Inject Inbound SMS & Evaluate Auto-Reply/i }));

    expect(await screen.findByText(/Evaluation Decision: matched_rule/i)).toBeInTheDocument();
    expect(screen.getByText("Auto-Reply Generated")).toBeInTheDocument();
    await waitFor(() => {
      expect(requests.some((r) => r.method === "POST" && r.url === "/api/v1/simulation/inject-inbound/")).toBe(true);
    });
  });

  it("generates a single-use short-lived QR pairing code for an Android SIM gateway handset", async () => {
    const user = userEvent.setup();
    installFetchMock(({ method, path }) => {
      if (method === "GET" && path === "/api/v1/devices/") {
        return mockJsonResponse([]);
      }
      if (method === "POST" && path === "/api/v1/devices/pair/init/") {
        return mockJsonResponse({
          pairing_id: "pair-001",
          pairing_code: "784920",
          qr_payload: '{"pairing_id":"pair-001","code":"784920"}',
          expires_at: "2026-01-15T12:15:00Z",
          ttl_seconds: 600,
          device_name_hint: "Campus Lab Galaxy S24",
        });
      }
      return null;
    });

    renderAppRoute("/devices");

    expect(await screen.findByText("No Android SIM Gateways paired yet")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Pair Android Handset/i }));

    const dialog = document.querySelector("dialog")!;
    await user.click(within(dialog).getByRole("button", { name: /Generate Single-Use Pairing Code & QR/i }));

    expect(await within(dialog).findByText("784920")).toBeInTheDocument();
    expect(dialog.querySelector("svg")).not.toBeNull();
  });
});
