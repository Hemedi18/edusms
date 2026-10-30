import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { installFetchMock, mockJsonResponse, renderAppRoute } from "./helpers";

const SAMPLE_CONTACTS = [
  {
    id: "cnt-1",
    name: "Amina Mwakasege",
    phone_number: "+255754100201",
    email: "amina@uni.ac.tz",
    notes: "CS101 Rep",
    tags: [],
    is_virtual: false,
    opt_in_status: true,
    opt_out_status: false,
    consent_source: "web_form",
    allow_outgoing: true,
    allow_auto_reply: null,
    allow_ai_reply: null,
    assigned_mode: null,
    cooldown_minutes: null,
    quiet_hours_start: null,
    quiet_hours_end: null,
    groups: [{ id: "grp-1", name: "CS101 Students", color: "#7C3AED" }],
    created_at: "2026-01-10T09:00:00Z",
    updated_at: "2026-01-10T09:00:00Z",
  },
];

describe("Contacts Management, Mandatory CSV Consent & Effective Policy Preview", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("enforces mandatory consent checkbox before enabling CSV import and submits consent_confirmed: true", async () => {
    const user = userEvent.setup();
    const { requests } = installFetchMock(({ method, path }) => {
      if (method === "GET" && path === "/api/v1/contacts/") {
        return mockJsonResponse(SAMPLE_CONTACTS);
      }
      if (method === "GET" && path === "/api/v1/groups/") {
        return mockJsonResponse([
          {
            id: "grp-1",
            name: "CS101 Students",
            description: "Year 1 CS",
            color: "#7C3AED",
            allow_outgoing: true,
            allow_auto_reply: true,
            allow_ai_reply: true,
            assigned_mode: null,
            cooldown_minutes: 15,
            quiet_hours_start: null,
            quiet_hours_end: null,
            member_count: 1,
            created_at: "2026-01-10T09:00:00Z",
          },
        ]);
      }
      if (method === "GET" && path === "/api/v1/suppressions/") {
        return mockJsonResponse([]);
      }
      if (method === "POST" && path === "/api/v1/contacts/import-csv/") {
        return mockJsonResponse({
          created_count: 2,
          existing_updated_count: 0,
          duplicate_in_file_count: 1,
          invalid_count: 0,
        });
      }
      return null;
    });

    renderAppRoute("/contacts");

    // Contacts table renders normalized E.164 phone & Opted In badge
    expect(await screen.findByText("Amina Mwakasege")).toBeInTheDocument();
    expect(screen.getByText("+255754100201")).toBeInTheDocument();
    expect(screen.getByText("Opted In")).toBeInTheDocument();

    // Open Import CSV Modal
    await user.click(screen.getByRole("button", { name: /Import CSV/i }));
    const dialog = document.querySelector("dialog")!;
    expect(dialog).not.toBeNull();

    const submitImportBtn = within(dialog).getByRole("button", { name: "Import Contacts" });
    expect(submitImportBtn).toBeDisabled();

    // Check Mandatory Authorization Confirmation checkbox
    const consentCheckbox = within(dialog).getByRole("checkbox", {
      name: /Mandatory Authorization Confirmation/i,
    });
    await user.click(consentCheckbox);
    expect(submitImportBtn).toBeEnabled();

    await user.click(submitImportBtn);

    await waitFor(() => {
      const importCall = requests.find((r) => r.method === "POST" && r.url === "/api/v1/contacts/import-csv/");
      expect(importCall).toBeDefined();
      expect((importCall!.body as { consent_confirmed: boolean }).consent_confirmed).toBe(true);
    });

    expect(await within(dialog).findByText("Import Summary")).toBeInTheDocument();
    expect(within(dialog).getByText(/Duplicates skipped: 1/i)).toBeInTheDocument();
  });

  it("fetches and displays Effective Contact Policy resolution with inheritance trace", async () => {
    const user = userEvent.setup();
    installFetchMock(({ method, path }) => {
      if (method === "GET" && path === "/api/v1/contacts/") {
        return mockJsonResponse(SAMPLE_CONTACTS);
      }
      if (method === "GET" && path === "/api/v1/groups/") {
        return mockJsonResponse([]);
      }
      if (method === "GET" && path === "/api/v1/suppressions/") {
        return mockJsonResponse([]);
      }
      if (method === "GET" && path === "/api/v1/contacts/cnt-1/effective-policy/") {
        return mockJsonResponse({
          contact_id: "cnt-1",
          contact_name: "Amina Mwakasege",
          phone_number: "+255754100201",
          can_send_outgoing: true,
          can_auto_reply: true,
          can_ai_reply: false,
          effective_mode_id: "mode-1",
          effective_mode_name: "Lecture Quiet Mode",
          effective_mode_source: "group:CS101 Students",
          effective_cooldown_minutes: 20,
          cooldown_source: "group:CS101 Students",
          in_quiet_hours: false,
          blocking_reasons: ["AI responder disabled by group policy"],
          inheritance_trace: [
            "Account global_automation_enabled = true",
            "Group CS101 Students assigned_mode = Lecture Quiet Mode",
            "Group CS101 Students allow_ai_reply = false",
          ],
        });
      }
      return null;
    });

    renderAppRoute("/contacts");

    expect(await screen.findByText("Amina Mwakasege")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Policy/i }));

    expect(await screen.findByText("Effective Contact Policy Resolution")).toBeInTheDocument();
    expect(screen.getAllByText(/Lecture Quiet Mode/).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("AI responder disabled by group policy")).toBeInTheDocument();
    expect(screen.getByText(/Group CS101 Students assigned_mode = Lecture Quiet Mode/)).toBeInTheDocument();
  });
});
