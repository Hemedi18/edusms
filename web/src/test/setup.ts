import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => {
  cleanup();
});

// Polyfill native HTMLDialogElement showModal() & close() for jsdom
if (typeof HTMLDialogElement !== "undefined") {
  if (typeof HTMLDialogElement.prototype.showModal !== "function") {
    HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
      this.setAttribute("open", "");
    };
  }
  if (typeof HTMLDialogElement.prototype.close !== "function") {
    HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement, returnValue?: string) {
      if (returnValue !== undefined) {
        this.returnValue = returnValue;
      }
      this.removeAttribute("open");
      this.dispatchEvent(new Event("close"));
    };
  }
}

// Configurable matchMedia mock supporting live "change" event listeners
type MediaListener = (event: MediaQueryListEvent) => void;
const mediaListeners = new Set<MediaListener>();
let systemPrefersDark = true;

export function setSystemPrefersDarkForTests(prefersDark: boolean): void {
  systemPrefersDark = prefersDark;
  const ev = {
    matches: prefersDark,
    media: "(prefers-color-scheme: dark)",
  } as MediaQueryListEvent;
  for (const listener of Array.from(mediaListeners)) {
    listener(ev);
  }
}

Object.defineProperty(window, "matchMedia", {
  writable: true,
  configurable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: query.includes("prefers-color-scheme: dark") ? systemPrefersDark : false,
    media: query,
    onchange: null,
    addListener: (cb: MediaListener) => mediaListeners.add(cb),
    removeListener: (cb: MediaListener) => mediaListeners.delete(cb),
    addEventListener: (_type: string, cb: MediaListener) => mediaListeners.add(cb),
    removeEventListener: (_type: string, cb: MediaListener) => mediaListeners.delete(cb),
    dispatchEvent: () => true,
  })),
});

// Safe no-op WebSocket mock for jsdom unit tests
class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  readyState = MockWebSocket.OPEN;
  url: string;
  onopen: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    queueMicrotask(() => {
      this.onopen?.(new Event("open"));
    });
  }
  send(_data: string): void {}
  close(): void {
    this.readyState = MockWebSocket.CLOSED;
  }
}

if (typeof window.WebSocket === "undefined" || !("OPEN" in window.WebSocket)) {
  vi.stubGlobal("WebSocket", MockWebSocket);
} else {
  vi.stubGlobal("WebSocket", MockWebSocket);
}
