import { describe, expect, it } from "vitest";
import {
  BUNDLED_ENGINE_ID,
  ENGINE_IDS,
  VISIBLE_ENGINE_IDS,
  familyAliasOfEnvKey,
  formatDraftTestVerdict,
  isBundledEngine,
  isEngineVisible,
  providerFamilyModels,
  visibleEngines,
} from "./providers";

describe("familyAliasOfEnvKey", () => {
  it("derives the alias id from the CLI's family env key shape", () => {
    expect(familyAliasOfEnvKey("ANTHROPIC_DEFAULT_OPUS_MODEL")).toBe("opus");
    expect(familyAliasOfEnvKey("ANTHROPIC_DEFAULT_FABLE_MODEL")).toBe("fable");
  });

  it("rejects non-family Anthropic keys", () => {
    // SMALL_FAST is a routing key, not a family remap; ANTHROPIC_MODEL is the
    // flat default. Neither names an alias row in the picker.
    expect(familyAliasOfEnvKey("ANTHROPIC_SMALL_FAST_MODEL")).toBeNull();
    expect(familyAliasOfEnvKey("ANTHROPIC_MODEL")).toBeNull();
    expect(familyAliasOfEnvKey("ANTHROPIC_DEFAULT_")).toBeNull();
  });
});

describe("providerFamilyModels", () => {
  const channel = (env: Record<string, string>) => ({
    name: "relay",
    settingsConfig: { env },
  });

  it("picks up a family the frontend never heard of", () => {
    // The mapping is derived from the key pattern, not a mirrored table: a
    // new ANTHROPIC_DEFAULT_<FAMILY>_MODEL ships with the CLI/backend and
    // works here without an edit.
    expect(
      providerFamilyModels("claude", channel({ ANTHROPIC_DEFAULT_NINE_MODEL: "m-9" })),
    ).toEqual({ nine: "m-9" });
  });

  it("reads both the flat env and settingsConfig.env, nested winning", () => {
    expect(
      providerFamilyModels("claude", {
        name: "relay",
        env: { ANTHROPIC_DEFAULT_OPUS_MODEL: "flat-opus" },
        settingsConfig: { env: { ANTHROPIC_DEFAULT_OPUS_MODEL: "nested-opus" } },
      }),
    ).toEqual({ opus: "nested-opus" });
  });

  it("ignores blank values and non-claude engines", () => {
    expect(
      providerFamilyModels("claude", channel({ ANTHROPIC_DEFAULT_OPUS_MODEL: "  " })),
    ).toEqual({});
    expect(
      providerFamilyModels("codex", channel({ ANTHROPIC_DEFAULT_OPUS_MODEL: "x" })),
    ).toEqual({});
  });
});

describe("engine visibility", () => {
  it("offers its own runtime first, then the vendor's CLI", () => {
    // MireAI bundles exactly one agent runtime (cli/), and that is the engine
    // the product surface leads with. MiniMax Code sits beside it as the
    // vendor's own CLI; adding a third engine is a deliberate edit here.
    expect([...VISIBLE_ENGINE_IDS]).toEqual(["mireai", "minimax"]);
    expect(BUNDLED_ENGINE_ID).toBe("mireai");
  });

  it("keeps every other engine id valid metadata while hiding it", () => {
    for (const engine of ENGINE_IDS) {
      expect(isEngineVisible(engine)).toBe(
        engine === BUNDLED_ENGINE_ID || engine === "minimax",
      );
    }
  });

  it("marks only the shipped runtime as the bundled one", () => {
    // The channel bridge, the wire-protocol field and 测试连接 all key off
    // this, so pointing it at MiniMax Code would drive the wrong CLI.
    for (const engine of ENGINE_IDS) {
      expect(isBundledEngine(engine)).toBe(engine === "mireai");
    }
  });

  it("rejects ids outside the registry instead of silently showing them", () => {
    expect(isEngineVisible("claude-desktop")).toBe(false);
    expect(isEngineVisible("")).toBe(false);
  });

  it("drops every row that is not on the visibility list", () => {
    const rows = [
      { id: "claude" },
      { id: "mireai" },
      { id: "minimax" },
      { id: "codex" },
      { id: "plugin:auto" },
    ];
    expect(visibleEngines(rows).map((row) => row.id)).toEqual(["mireai", "minimax"]);
  });
});

describe("formatDraftTestVerdict", () => {
  // The keys are what the mapping chooses; the localized sentence itself is
  // covered where the component renders it (ProviderFormSections.test.tsx).
  const t = ((key: string, options?: Record<string, unknown>) =>
    options ? `${key}:${String(options.status)}` : key) as never;
  const verdict = (errorCode: string, errorMessage = "", ok = false) =>
    formatDraftTestVerdict(t, { ok, state: ok ? "available" : "failed", errorCode, errorMessage });

  it("names every classification the CLI can report", () => {
    expect(verdict("", "", true)).toBe("settings.cliTestOk");
    expect(verdict("unauthorized")).toBe("settings.cliTestUnauthorized");
    expect(verdict("network")).toBe("settings.cliTestNetwork");
    expect(verdict("timeout")).toBe("settings.cliTestTimeout");
    expect(verdict("http_503")).toBe("settings.cliTestHttp:503");
    expect(verdict("provider_error")).toBe("settings.cliTestUpstream");
    expect(verdict("invalid_response")).toBe("settings.cliTestUpstream");
  });

  it("keeps the CLI's own words for a classification we do not know", () => {
    // Collapsing an unexpected answer into "测试失败" throws away the only
    // evidence about what the relay actually did.
    expect(verdict("weird", "upstream said something new")).toBe("upstream said something new");
    expect(verdict("weird")).toBe("settings.cliTestError");
  });
});
