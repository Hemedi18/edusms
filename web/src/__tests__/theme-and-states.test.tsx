import React, { useState } from "react";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeProvider, useTheme } from "../contexts/ThemeContext";
import { setSystemPrefersDarkForTests } from "../test/setup";
import { EmptyState, ErrorState, LoadingSkeleton } from "../components/States";
import { Modal } from "../components/Modal";
import { StatusBadge } from "../components/StatusBadge";

function ThemeProbe() {
  const { themeMode, resolvedTheme, setThemeMode } = useTheme();
  return (
    <div>
      <span data-testid="theme-mode">{themeMode}</span>
      <span data-testid="resolved-theme">{resolvedTheme}</span>
      <button type="button" onClick={() => setThemeMode("dark")}>
        Set Dark
      </button>
      <button type="button" onClick={() => setThemeMode("light")}>
        Set Light
      </button>
      <button type="button" onClick={() => setThemeMode("system")}>
        Set System
      </button>
    </div>
  );
}

describe("Theme System, UI States, Native Modal & Honest Status Badges", () => {
  beforeEach(() => {
    localStorage.clear();
    setSystemPrefersDarkForTests(true);
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.removeAttribute("data-theme-mode");
    document.documentElement.style.colorScheme = "";
  });

  it("persists dark, light, and system theme modes in localStorage and reacts live to OS matchMedia changes", async () => {
    const user = userEvent.setup();
    render(
      <ThemeProvider>
        <ThemeProbe />
      </ThemeProvider>
    );

    // Default is dark
    expect(screen.getByTestId("theme-mode")).toHaveTextContent("dark");
    expect(screen.getByTestId("resolved-theme")).toHaveTextContent("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.documentElement.style.colorScheme).toBe("dark");

    // Switch to light
    await user.click(screen.getByRole("button", { name: "Set Light" }));
    expect(localStorage.getItem("edusms_theme")).toBe("light");
    expect(screen.getByTestId("resolved-theme")).toHaveTextContent("light");
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(document.documentElement.dataset.themeMode).toBe("light");
    expect(document.documentElement.style.colorScheme).toBe("light");

    // Switch to system while OS prefers dark
    await user.click(screen.getByRole("button", { name: "Set System" }));
    expect(localStorage.getItem("edusms_theme")).toBe("system");
    expect(screen.getByTestId("theme-mode")).toHaveTextContent("system");
    expect(screen.getByTestId("resolved-theme")).toHaveTextContent("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");

    // Live OS preference flips to light without page reload
    act(() => {
      setSystemPrefersDarkForTests(false);
    });
    expect(screen.getByTestId("resolved-theme")).toHaveTextContent("light");
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(document.documentElement.style.colorScheme).toBe("light");

    // Live OS preference flips back to dark
    act(() => {
      setSystemPrefersDarkForTests(true);
    });
    expect(screen.getByTestId("resolved-theme")).toHaveTextContent("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("renders LoadingSkeleton, EmptyState, and ErrorState with accessible roles and retry action", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();

    render(
      <div>
        <LoadingSkeleton rows={3} label="Loading messages" />
        <EmptyState
          title="No SMS records yet"
          description="Send a simulated SMS to populate your inbox."
          action={<button type="button">Compose First SMS</button>}
        />
        <ErrorState title="Gateway timeout" message="Backend unreachable" onRetry={onRetry} />
      </div>
    );

    expect(screen.getByRole("status", { name: "Loading messages" })).toBeInTheDocument();
    expect(screen.getByText("No SMS records yet")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Compose First SMS" })).toBeInTheDocument();

    const alertBox = screen.getByRole("alert");
    expect(alertBox).toHaveTextContent("Gateway timeout");
    expect(alertBox).toHaveTextContent("Backend unreachable");

    await user.click(screen.getByRole("button", { name: /Retry/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("renders Modal using native <dialog closedby='any'> and closes cleanly via Close button", async () => {
    const user = userEvent.setup();

    function ModalHarness() {
      const [open, setOpen] = useState(false);
      return (
        <div>
          <button type="button" onClick={() => setOpen(true)}>
            Open Dialog
          </button>
          <Modal open={open} onClose={() => setOpen(false)} title="Inspect Telemetry" subtitle="Modal subtitle">
            <p>Dialog body content</p>
          </Modal>
        </div>
      );
    }

    render(<ModalHarness />);
    expect(screen.queryByText("Dialog body content")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Open Dialog" }));
    const dialogEl = document.querySelector("dialog");
    expect(dialogEl).not.toBeNull();
    expect(dialogEl).toHaveAttribute("open");
    expect(dialogEl).toHaveAttribute("closedby", "any");
    expect(screen.getByText("Inspect Telemetry")).toBeInTheDocument();
    expect(screen.getByText("Dialog body content")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Close dialog" }));
    expect(screen.queryByText("Dialog body content")).not.toBeInTheDocument();
  });

  it("renders strictly honest carrier vs simulation status badges", () => {
    render(
      <div>
        <StatusBadge status="submitted" isSimulation={false} />
        <StatusBadge status="delivered" isSimulation={false} />
        <StatusBadge status="simulated_delivered" isSimulation={true} />
        <StatusBadge status="delivery_unknown" isSimulation={false} />
        <StatusBadge status="pending_human_approval" isSimulation={false} />
      </div>
    );

    expect(screen.getByText("Accepted for Transmission (Unconfirmed Delivery)")).toBeInTheDocument();
    expect(screen.getByText("Carrier Delivered (Confirmed)")).toBeInTheDocument();
    expect(screen.getByText("Simulated (No Real SMS)")).toBeInTheDocument();
    expect(screen.getByText("Sent — Delivery Unknown")).toBeInTheDocument();
    expect(screen.getByText("Awaiting Human Review")).toBeInTheDocument();
  });
});
