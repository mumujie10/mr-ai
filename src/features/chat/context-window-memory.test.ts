import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ASSUMED_CONTEXT_WINDOW } from "./usage";
import {
  recallContextWindow,
  rememberContextWindow,
  resolveContextMax,
} from "./context-window-memory";

describe("context window memory", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("remembers a reported window per engine and model slot", () => {
    rememberContextWindow("claude", "default", 1_000_000);

    expect(recallContextWindow("claude", "default")).toBe(1_000_000);
    // Another slot (or engine) has its own memory.
    expect(recallContextWindow("claude", "sonnet")).toBeUndefined();
    expect(recallContextWindow("codex", "default")).toBeUndefined();
  });

  it("returns undefined for unknown slots and ignores non-positive windows", () => {
    expect(recallContextWindow("claude", "default")).toBeUndefined();

    rememberContextWindow("claude", "default", 0);

    expect(recallContextWindow("claude", "default")).toBeUndefined();
  });

  it("treats a broken storage as a cache miss instead of crashing", () => {
    // Replace the whole storage object. Spying is unreliable here: test-setup
    // installs a plain-object stub that never goes through Storage.prototype,
    // while a real jsdom Storage is a proxy whose named-property setter would
    // simply store the spy under the key "setItem".
    const brokenStorage: Storage = {
      getItem: () => null,
      setItem: () => {
        throw new Error("quota exceeded");
      },
      removeItem: () => {},
      clear: () => {},
      key: () => null,
      length: 0,
    };
    vi.stubGlobal("localStorage", brokenStorage);

    expect(() =>
      rememberContextWindow("claude", "default", 1_000_000),
    ).not.toThrow();

    expect(recallContextWindow("claude", "default")).toBeUndefined();
  });

  it("starts a fresh session at the remembered window instead of the 200k guess", () => {
    rememberContextWindow("claude", "default", 1_000_000);

    expect(
      resolveContextMax({
        usage: undefined,
        engine: "claude",
        model: "default",
      }),
    ).toBe(1_000_000);
  });

  it("prefers a live report, then memory, then the catalog, then the guess", () => {
    rememberContextWindow("claude", "default", 500_000);

    // A live report (the engine's own window) wins over memory and catalog.
    expect(
      resolveContextMax({
        usage: {
          input_tokens: 10,
          total_tokens: 10,
          model_context_window: 1_000_000,
        },
        engine: "claude",
        model: "default",
        catalogWindow: 200_000,
      }),
    ).toBe(1_000_000);

    // No live window: memory wins over the catalog.
    expect(
      resolveContextMax({
        usage: { input_tokens: 10, total_tokens: 10 },
        engine: "claude",
        model: "default",
        catalogWindow: 200_000,
      }),
    ).toBe(500_000);

    // No memory for this slot: the catalog wins.
    expect(
      resolveContextMax({
        usage: undefined,
        engine: "claude",
        model: "sonnet",
        catalogWindow: 200_000,
      }),
    ).toBe(200_000);

    // Nothing anywhere: the shared guess.
    expect(
      resolveContextMax({ usage: undefined, engine: "pi", model: "x" }),
    ).toBe(ASSUMED_CONTEXT_WINDOW);
  });

  it("a window the user set in 模型设置 outranks a live report", () => {
    rememberContextWindow("claude", "opus", 500_000);
    const live = {
      input_tokens: 10,
      total_tokens: 10,
      model_context_window: 1_000_000,
    };
    expect(
      resolveContextMax({
        usage: live,
        engine: "claude",
        model: "opus",
        catalogWindow: 200_000,
        modelWindow: 400_000,
      }),
    ).toBe(400_000);
    // Without the override the old order still holds: report, memory, catalog.
    expect(
      resolveContextMax({
        usage: live,
        engine: "claude",
        model: "opus",
        catalogWindow: 200_000,
      }),
    ).toBe(1_000_000);
  });
});
