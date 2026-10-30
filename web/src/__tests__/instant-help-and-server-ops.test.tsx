import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { installFetchMock, mockJsonResponse, renderAppRoute } from "./helpers";

describe("Instant Help Drawer, Screen Capture, Support Console & Server GitHub Sync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("renders floating Instant Help button, opens side chat, and captures screenshot", async () => {
    const user = userEvent.setup();
    installFetchMock(({ method, path }) => {
      if (method === "POST" && path === "/api/v1/support/threads/active/") {
        return mockJsonResponse({
          id: "thread-1",
          short_id: "ABCD1234",
          user_email: "dev@edusms.local",
          user_name: "EduSMS Dev",
          subject: "Instant Help",
          mode: "live_human",
          status: "open",
          reply_token: "educhat_tok123",
          first_email_notified: true,
          customer_context: { email: "dev@edusms.local", user_kind: "Verified Developer Account" },
          unread_for_admin: 0,
          unread_for_user: 0,
          last_message_at: new Date().toISOString(),
          messages: [
            {
              id: "msg-1",
              thread: "thread-1",
              sender_type: "ai",
              sender_label: "EduSMS Instant Help",
              via_channel: "ai_helper",
              body: "Welcome to EduSMS Instant Help!",
              screenshot_data_url: "",
              created_at: new Date().toISOString(),
            },
          ],
        });
      }
      return undefined;
    });

    renderAppRoute("/login", { authenticated: false });

    const fab = await screen.findByTestId("instant-help-fab");
    expect(fab).toBeInTheDocument();

    await user.click(fab);
    expect(await screen.findByText("Instant Help & AI Support")).toBeInTheDocument();
    expect(await screen.findByText("Welcome to EduSMS Instant Help!")).toBeInTheDocument();

    const screenshotBtn = screen.getByTestId("instant-help-screenshot-btn");
    expect(screenshotBtn).toBeInTheDocument();
  });

  it("renders Support Console with automatic Customer & Session Info sidebar and Server GitHub Sync button", async () => {
    installFetchMock(({ method, path }) => {
      if (method === "GET" && path === "/api/v1/support/threads/") {
        return mockJsonResponse([
          {
            id: "t-100",
            short_id: "T100ABCD",
            user_email: "student@edusphere.co.tz",
            user_name: "Amina Student",
            subject: "Live Support",
            mode: "live_human",
            status: "awaiting_admin",
            reply_token: "educhat_reply999",
            first_email_notified: true,
            customer_context: {
              email: "student@edusphere.co.tz",
              full_name: "Amina Student",
              organization: "UDSM Lab",
              user_kind: "Verified Developer Account",
              email_verified: true,
              page_url: "https://edusms.edusphere.co.tz/campaigns",
              session: {
                session_id: "sess-xyz-987",
                device_label: "Chrome on Linux",
                ip_address: "197.250.10.22",
                user_agent: "Mozilla/5.0",
              },
              telemetry: {
                online_devices_count: 1,
                paired_devices_count: 1,
                total_messages_count: 42,
                active_mode: "Default",
                unresolved_errors_count: 0,
              },
            },
            unread_for_admin: 1,
            unread_for_user: 0,
            last_message_at: new Date().toISOString(),
            messages: [
              {
                id: "m-1",
                thread: "t-100",
                sender_type: "user",
                sender_label: "Amina Student",
                via_channel: "web_chat",
                body: "Need help setting up my SIM gateway!",
                screenshot_data_url: "",
                created_at: new Date().toISOString(),
              },
            ],
          },
        ]);
      }
      if (method === "GET" && path === "/api/v1/support/errors/") {
        return mockJsonResponse([]);
      }
      if (method === "GET" && path === "/api/v1/ops/status/") {
        return mockJsonResponse({
          config: { cpanel_host: "https://edusphere.co.tz:2083", cpanel_username: "eduspher" },
          cpanel_summary: {
            primary_domain: "edusphere.co.tz",
            target_subdomain: "edusms.edusphere.co.tz",
            cpanel_host: "https://edusphere.co.tz:2083",
            cpanel_username: "eduspher",
            credentials_configured: true,
            mcp_bridge_configured: true,
            mcp_endpoint: "https://mcp.webpros.com/api/mcp",
            document_root: "/home/eduspher/public_html/edusms",
            passenger_wsgi_ready: true,
            email_accounts: [
              {
                email: "support@edusms.edusphere.co.tz",
                purpose: "Automatic Error Responding & Live Chat Bridge",
                smtp_host: "mail.edusphere.co.tz",
                smtp_port: 587,
                status: "Active",
              },
            ],
            quota: { megabyte_limit: 20480, megabytes_used: 412, inodes_used: 1200 },
          },
          git_status: {
            initialized: true,
            branch: "main",
            commit_sha: "a1b2c3d",
            last_commit_message: "first commit",
            last_commit_date: "2026-10-30",
            remote_url: "https://github.com/Hemedi18/edusms.git",
            working_tree_clean: true,
            modified_files_count: 0,
            last_sync_at: null,
            last_sync_status: "ready",
            last_sync_output: "",
          },
        });
      }
      return undefined;
    });

    const { unmount } = renderAppRoute("/support", { authenticated: true });

    expect(await screen.findByTestId("customer-context-sidebar")).toBeInTheDocument();
    expect(await screen.findByText("Verified Developer Account")).toBeInTheDocument();
    expect(await screen.findByText("197.250.10.22")).toBeInTheDocument();
    unmount();

    renderAppRoute("/server-ops", { authenticated: true });

    expect(await screen.findByTestId("github-sync-btn")).toBeInTheDocument();
    expect(await screen.findByTestId("copy-cmd-start-local-all")).toBeInTheDocument();
  });
});
