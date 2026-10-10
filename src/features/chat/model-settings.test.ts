import { describe, expect, it } from "vitest";
import {
  hiddenModelIds,
  modelSettingFor,
  modelSettingKey,
  withModelSetting,
} from "./model-settings";

describe("modelSettingKey / modelSettingFor", () => {
  it("keys by engine + picker id, so channels stay separate rows", () => {
    expect(modelSettingKey("mireai", "llm/MiniMax-M3")).toBe(
      "mireai::llm/MiniMax-M3",
    );
    const byKey = {
      "mireai::llm/MiniMax-M3": { contextWindow: 400_000 },
      "minimax::llm/MiniMax-M3": { contextWindow: 200_000 },
    };
    expect(modelSettingFor(byKey, "mireai", "llm/MiniMax-M3")?.contextWindow).toBe(
      400_000,
    );
    // Same model id, different engine: never the other engine's override.
    expect(modelSettingFor(byKey, "minimax", "llm/MiniMax-M3")?.contextWindow).toBe(
      200_000,
    );
    expect(modelSettingFor(byKey, "claude", "llm/MiniMax-M3")).toBeUndefined();
  });

  it("treats an empty model as the CLI's own default slot", () => {
    const byKey = { "mireai::default": { hidden: true } };
    expect(modelSettingFor(byKey, "mireai", "")?.hidden).toBe(true);
    expect(modelSettingFor(byKey, "mireai", null)?.hidden).toBe(true);
  });
});

describe("withModelSetting", () => {
  it("merges fields of one row instead of replacing them", () => {
    let byKey = withModelSetting({}, "mireai", "llm/x", { contextWindow: 400_000 });
    byKey = withModelSetting(byKey, "mireai", "llm/x", { effort: "high" });
    expect(byKey).toEqual({
      "mireai::llm/x": { contextWindow: 400_000, effort: "high" },
    });
  });

  it("deletes a row that has nothing left set", () => {
    let byKey = withModelSetting({}, "mireai", "llm/x", { hidden: true });
    byKey = withModelSetting(byKey, "mireai", "llm/x", { hidden: false });
    expect(byKey).toEqual({});
    // Clearing one field keeps the others.
    byKey = withModelSetting({ "mireai::llm/x": { hidden: true, effort: "low" } }, "mireai", "llm/x", {
      hidden: false,
    });
    expect(byKey).toEqual({ "mireai::llm/x": { effort: "low" } });
  });
});

describe("hiddenModelIds", () => {
  it("lists only this engine's hidden rows, with the prefix stripped", () => {
    const byKey = {
      "mireai::llm/a": { hidden: true },
      "mireai::llm/b": { effort: "high" },
      "codex::llm/a": { hidden: true },
    };
    expect(hiddenModelIds(byKey, "mireai")).toEqual(["llm/a"]);
    expect(hiddenModelIds(byKey, "codex")).toEqual(["llm/a"]);
    expect(hiddenModelIds(undefined, "mireai")).toEqual([]);
  });
});
