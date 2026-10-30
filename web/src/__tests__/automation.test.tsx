import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { installFetchMock, mockJsonResponse, renderAppRoute } from "./helpers";

describe("Automation Hub: Rule Builder, Live Dry-Run Tester & AI Provider Masked Secrets", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("creates a new auto-reply rule and runs the Live Rule & Policy Dry-Run Tester", async () => {
    const user = userEvent.setup();
    const rulesState = [
      {
        id: "rule-1",
        name: "Fee Balance Rule",
        description: "",
        is_enabled: true,
        priority: 90,
        match_mode: "contains",
        keywords: ["tuition", "fees"],
        case_sensitive: false,
        response_template: "Hi {{contact_name}}, visit portal.uni.ac.tz for fee statements.",
        cooldown_minutes: 15,
        max_replies_per_day: 3,
        require_human_approval: false,
        schedule: null,
        target_groups: [],
        hit_count: 4,
        last_triggered_at: null,
        created_at: "2026-01-12T10:00:00Z",
      },
    ];

    const { requests } = installFetchMock(({ method, path, body }) => {
      if (method === "GET" && path === "/api/v1/automation/rules/") {
        return mockJsonResponse(rulesState);
      }
      if (method === "POST" && path === "/api/v1/automation/rules/") {
        const created = {
          id: "rule-2",
          ...(body as Record<string, unknown>),
          hit_count: 0,
          last_triggered_at: null,
          created_at: "2026-01-15T10:00:00Z",
        };
        rulesState.push(created as (typeof rulesState)[number]);
        return mockJsonResponse(created, 201);
      }
      if (method === "GET" && path === "/api/v1/automation/schedules/") {
        return mockJsonResponse([]);
      }
      if (method === "GET" && path === "/api/v1/automation/ai-providers/") {
        return mockJsonResponse([]);
      }
      if (method === "GET" && path === "/api/v1/automation/ai-logs/") {
        return mockJsonResponse([]);
      }
      if (method === "GET" && path === "/api/v1/automation/ai-providers/supported-models/") {
        return mockJsonResponse({ deterministic_mock: ["edusms-mock-v1"] });
      }
      if (method === "POST" && path === "/api/v1/automation/rules/test/") {
        return mockJsonResponse({
          would_reply: true,
          decision: "matched_rule",
          matched_rule_id: "rule-2",
          matched_rule_name: "Exam Timetable Rule",
          matched_pattern: "timetable",
          active_mode: "Office Hours",
          response_preview: "Hello Amina, final exam timetables are posted on noticeboard B.",
          require_human_approval: false,
          diagnostics: [
            "Global automation switch: ON",
            "Rule 'Exam Timetable Rule' matched substring 'timetable' (priority 85)",
          ],
        });
      }
      return null;
    });

    renderAppRoute("/automation");

    expect(await screen.findByText("Fee Balance Rule")).toBeInTheDocument();

    // Open Rule Builder modal and create a new rule
    await user.click(screen.getByRole("button", { name: /New Rule/i }));
    const dialog = document.querySelector("dialog")!;
    await user.type(within(dialog).getByLabelText("Rule Name"), "Exam Timetable Rule");
    await user.type(
      within(dialog).getByLabelText(/Keywords or Regex Patterns/i),
      "timetable, exam schedule"
    );
    const tplField = within(dialog).getByLabelText(/Response Template/i);
    fireEvent.change(tplField, {
      target: { value: "Hello {{contact_name}}, final exam timetables are posted on noticeboard B." },
    });
    await user.click(within(dialog).getByRole("button", { name: "Save Rule" }));

    await waitFor(() => {
      const postRule = requests.find((r) => r.method === "POST" && r.url === "/api/v1/automation/rules/");
      expect(postRule).toBeDefined();
      expect((postRule!.body as { keywords: string[] }).keywords).toEqual(["timetable", "exam schedule"]);
    });

    const matchedElements = await screen.findAllByText("Exam Timetable Rule");
    expect(matchedElements.length).toBeGreaterThanOrEqual(1);

    // Run Live Dry-Run Tester
    const sampleBodyInput = screen.getByLabelText("Sample Incoming SMS Body");
    await user.clear(sampleBodyInput);
    await user.type(sampleBodyInput, "Can you share the exam timetable?");
    await user.click(screen.getByRole("button", { name: "Run Dry-Run Evaluation" }));

    const dryOutput = await screen.findByRole("region", { name: "Dry-run evaluation output" });
    expect(dryOutput).toHaveTextContent("Would Auto-Reply");
    expect(dryOutput).toHaveTextContent("matched_rule");
    expect(dryOutput).toHaveTextContent("Hello Amina, final exam timetables are posted on noticeboard B.");
  });

  it("displays masked AI provider API keys and preserves stored secret when edited with blank key field", async () => {
    const user = userEvent.setup();
    const { requests } = installFetchMock(({ method, path }) => {
      if (method === "GET" && path === "/api/v1/automation/rules/") return mockJsonResponse([]);
      if (method === "GET" && path === "/api/v1/automation/schedules/") return mockJsonResponse([]);
      if (method === "GET" && path === "/api/v1/automation/ai-logs/") return mockJsonResponse([]);
      if (method === "GET" && path === "/api/v1/automation/ai-providers/supported-models/") {
        return mockJsonResponse({ openai_compatible: ["gpt-4o-mini"] });
      }
      if (method === "GET" && path === "/api/v1/automation/ai-providers/") {
        return mockJsonResponse([
          {
            id: "prov-1",
            name: "Department OpenAI Gateway",
            provider_type: "openai_compatible",
            is_enabled: true,
            api_base_url: "https://api.openai.com/v1",
            has_api_key: true,
            masked_api_key: "sk-proj...9f2a",
            model_name: "gpt-4o-mini",
            timeout_seconds: 12,
            max_output_chars: 300,
            temperature: 0.2,
            system_instructions: "Be concise.",
            fallback_message: "Coordinator will reply shortly.",
            simulate_failure: false,
            last_tested_at: null,
            last_test_status: "ok",
            last_error: "",
            updated_at: "2026-01-15T10:00:00Z",
          },
        ]);
      }
      if (method === "PATCH" && path === "/api/v1/automation/ai-providers/prov-1/") {
        return mockJsonResponse({ id: "prov-1" });
      }
      return null;
    });

    renderAppRoute("/automation");

    // Switch to AI Providers & Logs tab
    const aiTabBtn = await screen.findByRole("button", { name: /AI Providers & Logs/i });
    await user.click(aiTabBtn);

    // Displays masked API key, never raw secret
    expect(await screen.findByText("Department OpenAI Gateway")).toBeInTheDocument();
    expect(screen.getByText("sk-proj...9f2a")).toBeInTheDocument();

    // Click Edit on the provider
    await user.click(screen.getByRole("button", { name: "Edit" }));
    const dialog = document.querySelector("dialog")!;
    expect(within(dialog).getByText(/Saved: sk-proj\.\.\.9f2a/i)).toBeInTheDocument();

    const keyInput = within(dialog).getByLabelText(/API Key/i) as HTMLInputElement;
    expect(keyInput.value).toBe("");

    // Update display name without typing a new API key
    const nameInput = within(dialog).getByLabelText("Provider Display Name");
    await user.clear(nameInput);
    await user.type(nameInput, "Updated OpenAI Gateway");
    await user.click(within(dialog).getByRole("button", { name: "Save AI Provider" }));

    await waitFor(() => {
      const patchCall = requests.find(
        (r) => r.method === "PATCH" && r.url === "/api/v1/automation/ai-providers/prov-1/"
      );
      expect(patchCall).toBeDefined();
      const bodyObj = patchCall!.body as Record<string, unknown>;
      expect(bodyObj.name).toBe("Updated OpenAI Gateway");
      // Crucial: blank API key field MUST NOT send an empty api_key that overwrites the stored secret
      expect("api_key" in bodyObj).toBe(false);
    });
  });
});
