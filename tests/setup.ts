import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";

// jsdom implements neither matchMedia nor the Web Animations API. These test doubles
// exist only in the jsdom environment; WebView2 and WKWebView provide the real APIs.
if (typeof window !== "undefined") {
  const { cleanup } = await import("@testing-library/react");
  afterEach(() => {
    cleanup();
  });

  window.matchMedia = vi.fn((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(() => false),
  }));

  Element.prototype.animate = vi.fn(() => ({ cancel: vi.fn() }) as unknown as Animation);
}
