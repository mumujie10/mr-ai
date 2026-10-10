import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@/lib/i18n";
import { EngineModelPanel } from "./engine-model-panel";
import { effortChoices, effortLabel } from "./effort-levels";

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/**
 * The effort control must show the levels the engine actually advertises for the
 * session's model — see `qoder_session::effort_levels_of` and the ACP
 * `thinkingEffort` option. Three states matter: not reported yet (keep the app's
 * fixed list), a reported subset (render exactly those stops), and an explicit
 * "this model has no effort knob" (say so, draw no slider).
 */

/** One tick per real stop: the slider draws a bar per level it was given, so
 *  counting them is counting the levels the engine actually offered. */
const stops = (container: HTMLElement) =>
  container.querySelectorAll(".bg-foreground-icon-tertiary").length;

function renderPanel(root: Root, effortLevels?: Record<string, string[] | null>) {
  act(() => {
    root.render(
      <EngineModelPanel
        option={{ id: "mireai", label: "MireAI CLI" }}
        models={[{ id: "kimi-k2", label: "kimi-k2" }]}
        selectedModelId="kimi-k2"
        query=""
        onQueryChange={() => {}}
        effort="high"
        effortLevels={effortLevels}
        onPickModel={() => {}}
        onEffortChange={vi.fn()}
        ompServiceTier="default"
        onOmpServiceTierChange={async () => {}}
        codexServiceTier="default"
        onCodexServiceTierChange={async () => {}}
      />,
    );
  });
}

describe("effort stops follow what the engine advertises", () => {
  let container: HTMLDivElement;
  let root: Root;

  const setup = () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    return { container, root };
  };

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("renders six stops before the engine reports anything", () => {
    setup();
    renderPanel(root, undefined);
    expect(stops(container)).toBe(6);
  });

  it("renders exactly the advertised stops after it reports", () => {
    setup();
    renderPanel(root, { mireai: ["minimal", "low"] });
    expect(stops(container)).toBe(2);
  });

  it("draws no slider when the model declares no effort knob", () => {
    setup();
    renderPanel(root, { mireai: [] });
    expect(stops(container)).toBe(0);
    expect(container.textContent).toContain(
      "这个模型没有可切换的推理档位，由 CLI 自己决定",
    );
  });

  it("trims only the engine that reported", () => {
    setup();
    // Another engine's report must not reshape this one's control.
    renderPanel(root, { kimi: ["low"] });
    expect(stops(container)).toBe(6);
  });

  it("labels an unlisted level with the engine's own word", () => {
    const t = (key: string) => key;
    expect(effortLabel("high", t)).toBe("chat.effortHigh");
    expect(effortLabel("minimal", t)).toBe("minimal");
    expect(effortChoices(undefined)).toEqual([
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
      "ultra",
    ]);
    expect(effortChoices(["minimal", "low"])).toEqual(["minimal", "low"]);
    // Nothing to offer is `null`, not an empty list the slider would divide by.
    expect(effortChoices([])).toBeNull();
  });
});
