import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ipc } from "@/lib/ipc";
import "@/lib/i18n";
import i18n from "@/lib/i18n";
import type { ChannelOption } from "@/components/application/ai-chat/engine-model-panel";
import type { ModelOption } from "@/components/application/ai-chat/cli-menu";
import { PSEUDO_LOCAL } from "@/features/settings/providers";
import { useModelSettings } from "../model-settings";
import { ModelSettingsDialog } from "./ModelSettingsDialog";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

vi.mock("@/lib/ipc", () => ({
  ipc: {
    getAppSettings: vi.fn(async () => ({ modelSettings: {} })),
    updateAppSettings: vi.fn(async () => ({})),
  },
}));

const MODELS = [
  { id: "llm/MiniMax-M3", label: "MiniMax-M3", provider: "llm" },
  { id: "minimax/MiniMax-M2.7", label: "MiniMax-M2.7", provider: "minimax" },
];

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  useModelSettings.setState({ byKey: {}, loaded: true });
  vi.mocked(ipc.updateAppSettings).mockClear();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  // ModalShell portals to document.body; drop the leftover overlay so the next
  // test's query cannot match the previous dialog.
  document.body.innerHTML = "";
});

function render(props: Partial<Parameters<typeof ModelSettingsDialog>[0]> = {}) {
  act(() =>
    root.render(
      <ModelSettingsDialog
        engineId="mireai"
        models={MODELS}
        onClose={() => {}}
        {...props}
      />,
    ),
  );
}

// ModalShell portals to document.body, so that — not the mount container — is
// where the dialog lives.
const text = () => document.body.textContent ?? "";

const switches = () =>
  [...document.querySelectorAll<HTMLButtonElement>('[role="switch"]')];

describe("ModelSettingsDialog", () => {
  it("lists one row per model, with its channel as the second line", async () => {
    render();
    expect(text()).toContain("MiniMax-M3");
    expect(text()).toContain("MiniMax-M2.7");
    // Both channels of the same engine are separate rows.
    expect(switches().length).toBe(2);
  });

  describe("按渠道分组展示", () => {
    const CHANNELS: ChannelOption[] = [
      { id: PSEUDO_LOCAL, label: "官方配置", kind: "official" },
      { id: "llm", label: "llm", kind: "custom" },
    ];
    const BY_CHANNEL: Record<string, ModelOption[]> = {
      [PSEUDO_LOCAL]: [{ id: "minimax/MiniMax-M2.7", label: "MiniMax-M2.7", provider: "minimax" }],
      llm: [{ id: "llm/MiniMax-M3", label: "MiniMax-M3", provider: "llm" }],
    };
    const captions = () =>
      [...document.querySelectorAll("span")].filter((s) =>
        ["官方配置", "llm"].includes(s.textContent?.trim() ?? ""),
      ).length;

    it("每个渠道各占一段，两段同时在场，一行都不藏", () => {
      render({ channels: CHANNELS, modelsByChannel: BY_CHANNEL });
      expect(captions()).toBeGreaterThanOrEqual(2);
      // Both channels' rows stay editable at once.
      expect(text()).toContain("MiniMax-M3");
      expect(text()).toContain("MiniMax-M2.7");
      expect(switches().length).toBe(2);
    });

    it("没有模型行的渠道照样列出来，不配解释", () => {
      render({
        channels: CHANNELS,
        modelsByChannel: { [PSEUDO_LOCAL]: [], llm: BY_CHANNEL.llm },
      });
      expect(text()).toContain("官方配置");
      expect(text()).toContain("MiniMax-M3");
      expect(switches().length).toBe(1);
    });

    it("没有渠道数据时回落到一列全部行（旧样子）", () => {
      render({ channels: CHANNELS });
      expect(text()).toContain("MiniMax-M3");
      expect(text()).toContain("MiniMax-M2.7");
      expect(text()).not.toContain("官方配置");
    });
  });

  it("keeps a hidden row editable — hiding must be undoable", () => {
    useModelSettings.setState({
      byKey: { "mireai::llm/gone": { hidden: true } },
      loaded: true,
    });
    render();
    expect(text()).toContain("llm/gone");
    expect(text()).toContain(i18n.t("chat.modelHidden"));
  });

  it("writes the visibility switch through the shared store", async () => {
    render();
    await act(async () => {
      switches()[0].click();
    });
    expect(useModelSettings.getState().byKey).toEqual({
      "mireai::llm/MiniMax-M3": { hidden: true },
    });
    await vi.waitFor(() => expect(ipc.updateAppSettings).toHaveBeenCalled());
    const sent = vi
      .mocked(ipc.updateAppSettings)
      .mock.calls.at(-1)?.[0] as unknown as { modelSettings: unknown };
    expect(sent.modelSettings).toEqual({
      "mireai::llm/MiniMax-M3": { hidden: true },
    });
  });

  it("says so when the engine reported no reasoning knob, instead of an inert control", () => {
    render({ effortLevels: [] });
    expect(text()).toContain(i18n.t("chat.effortNoneForModel"));
    expect(effortTrigger("MiniMax-M3")).toBeNull();
  });

  it("shows the stored level as the row's value, and 跟随引擎默认 when unset", () => {
    // The advertised stops feed react-aria's Select, whose listbox cannot mount
    // in jsdom (react-aria's selection util throws on `escape`), so this pins
    // what the trigger renders rather than opening it.
    useModelSettings.setState({
      byKey: { "mireai::llm/MiniMax-M3": { effort: "high" } },
      loaded: true,
    });
    render({ effortLevels: ["low", "high"] });
    expect(effortTrigger("MiniMax-M3")?.textContent).toContain("high");
    expect(effortTrigger("MiniMax-M2.7")?.textContent).toContain(
      i18n.t("chat.modelEffortFollowEngine"),
    );
  });
});

/** The react-aria Select trigger is a plain button — find it by the accessible
 *  name the dialog gives it (column · model). */
function effortTrigger(modelLabel: string): HTMLButtonElement | null {
  return document.querySelector<HTMLButtonElement>(
    `button[aria-label="${i18n.t("chat.modelEffortColumn")} · ${modelLabel}"]`,
  );
}
