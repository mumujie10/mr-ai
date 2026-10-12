import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import "@/lib/i18n";
import i18n from "@/lib/i18n";
import { PSEUDO_LOCAL } from "@/features/settings/providers";
import { EngineModelPanel, type ChannelOption } from "./engine-model-panel";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

/** More channels than fit the flyout: a machine with a dozen relays used to
 *  render every one of them inline, pushing the model list off the panel. */
const CHANNELS = Array.from({ length: 11 }, (_, index) => ({
  id: `p${index + 1}`,
  label: `provider-${index + 1}`,
  kind: "custom" as const,
}));

describe("EngineModelPanel channel picker", () => {
  let container: HTMLDivElement;
  let root: Root;
  let onPickChannel: Mock;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    onPickChannel = vi.fn();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const render = (selectedChannelId: string, channels: ChannelOption[] = CHANNELS) =>
    act(() => {
      root.render(
        <EngineModelPanel
          option={{ id: "codex", label: "Codex" }}
          models={[]}
          selectedModelId=""
          query=""
          onQueryChange={() => {}}
          effort="medium"
          onPickModel={() => {}}
          onEffortChange={() => {}}
          channels={channels}
          selectedChannelId={selectedChannelId}
          onPickChannel={onPickChannel}
          ompServiceTier={null}
          onOmpServiceTierChange={async () => {}}
          codexServiceTier={null}
          onCodexServiceTierChange={async () => {}}
        />,
      );
    });

  /** The dropdown trigger is the only aria-expanded control on the panel. */
  const trigger = () =>
    container.querySelector<HTMLButtonElement>("button[aria-expanded]");

  it("shows only the selected channel until the dropdown is opened", () => {
    render("p2");
    expect(trigger()?.textContent).toContain("provider-2");
    expect(trigger()?.getAttribute("aria-expanded")).toBe("false");
    expect(container.textContent).not.toContain("provider-9");

    act(() => trigger()!.click());
    expect(trigger()?.getAttribute("aria-expanded")).toBe("true");
    expect(container.textContent).toContain("provider-9");
  });

  it("picks a channel and closes the dropdown", () => {
    render("p2");
    act(() => trigger()!.click());
    const row = [...container.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "provider-9",
    );
    expect(row).toBeTruthy();
    act(() => row!.click());
    expect(onPickChannel).toHaveBeenCalledWith("codex", "p9");
    expect(trigger()?.getAttribute("aria-expanded")).toBe("false");
    expect(container.textContent).not.toContain("provider-9");
  });

  it("follows the selected channel the parent hands back", () => {
    render("p2");
    expect(trigger()?.textContent).toContain("provider-2");
    render("p9");
    expect(trigger()?.textContent).toContain("provider-9");
  });

  /** The header field is contracted by its accessible name (the i18n key),
   *  so the assertion does not depend on where it sits in the DOM. */
  const filterInput = () =>
    container.querySelector<HTMLInputElement>(
      `input[aria-label="${i18n.t("chat.channelFilterPlaceholder")}"]`,
    );

  const type = async (input: HTMLInputElement, value: string) => {
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  };

  it("narrows the channel list from the header filter", async () => {
    render("p2");
    await type(filterInput()!, "provider-9");
    // Typing opens the list, and only the match survives the filter.
    expect(trigger()?.getAttribute("aria-expanded")).toBe("true");
    expect(container.textContent).toContain("provider-9");
    expect(container.textContent).not.toContain("provider-1");
  });

  it("says so when the channel filter matches nothing", async () => {
    render("p2");
    await type(filterInput()!, "no-such-channel");
    expect(container.textContent).toContain(i18n.t("chat.noMatchingChannels"));
  });

  it("picks a filtered channel and clears the filter", async () => {
    render("p2");
    await type(filterInput()!, "provider-9");
    const row = [...container.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "provider-9",
    );
    expect(row).toBeTruthy();
    act(() => row!.click());
    expect(onPickChannel).toHaveBeenCalledWith("codex", "p9");
    expect(trigger()?.getAttribute("aria-expanded")).toBe("false");
    expect(filterInput()?.value).toBe("");
  });

  it("shows no channel UI for an engine without channels", () => {
    // omp until a channel is added in settings: an empty channels array is
    // still truthy, and the filter box used to render narrowing nothing.
    act(() => {
      root.render(
        <EngineModelPanel
          option={{ id: "omp", label: "OMP" }}
          models={[]}
          selectedModelId=""
          query=""
          onQueryChange={() => {}}
          effort="medium"
          onPickModel={() => {}}
          onEffortChange={() => {}}
          channels={[]}
          selectedChannelId=""
          onPickChannel={onPickChannel}
          ompServiceTier={null}
          onOmpServiceTierChange={async () => {}}
          codexServiceTier={null}
          onCodexServiceTierChange={async () => {}}
        />,
      );
    });
    expect(filterInput()).toBeNull();
    expect(trigger()).toBeNull();
  });

  it("renders effort slider for all supported CLI engines", () => {
    // Supported engine: codex
    render("p1");
    expect(container.querySelector("[aria-label='推理强度']")).toBeTruthy();

    // Supported engine: kimi
    act(() => {
      root.render(
        <EngineModelPanel
          option={{ id: "kimi", label: "Kimi" }}
          models={[]}
          selectedModelId=""
          query=""
          onQueryChange={() => {}}
          effort="medium"
          onPickModel={() => {}}
          onEffortChange={() => {}}
          channels={[]}
          selectedChannelId=""
          onPickChannel={onPickChannel}
          ompServiceTier={null}
          onOmpServiceTierChange={async () => {}}
          codexServiceTier={null}
          onCodexServiceTierChange={async () => {}}
        />,
      );
    });
    expect(container.querySelector("[aria-label='推理强度']")).toBeTruthy();
  });

  const official: ChannelOption = {
    id: PSEUDO_LOCAL,
    label: i18n.t("settings.cliOfficial"),
    kind: "official",
  };
  const relay: ChannelOption = { id: "llm", label: "llm", kind: "custom" };
  const radios = () => [...container.querySelectorAll<HTMLElement>("[role='radio']")];
  const open = () => act(() => trigger()!.click());

  describe("官方配置 与供应商渠道", () => {
    it("groups the channels added here under the settings page's own caption", () => {
      render(PSEUDO_LOCAL, [official, relay]);
      open();
      const text = container.textContent ?? "";
      // 供应商渠道 is what 设置 already calls this group — one name, one group.
      expect(text).toContain(i18n.t("settings.cliChannels"));
      // 官方配置 leads, the caption opens the app-managed group after it.
      expect(text.indexOf(i18n.t("settings.cliOfficial"))).toBeLessThan(
        text.indexOf(i18n.t("settings.cliChannels")),
      );
      expect(text.indexOf(i18n.t("settings.cliChannels"))).toBeLessThan(text.indexOf("llm"));
    });

    it("keeps 官方配置 selectable beside a provider channel — the two do not compete", () => {
      render("llm", [official, relay]);
      open();
      // Reading the rows first: picking one closes the list and unmounts them.
      const rows = radios();
      expect(rows.length).toBe(2);
      expect(rows[0].tagName).toBe("BUTTON");
      act(() => rows[0].click());
      expect(onPickChannel).toHaveBeenCalledWith("codex", PSEUDO_LOCAL);
    });

    it("says nothing extra when the engine has only its official config", () => {
      // 内置只有官方一行:显示出来就够,不配任何"怎么还没配"的解释。
      render(PSEUDO_LOCAL, [official]);
      open();
      const text = container.textContent ?? "";
      expect(text).toContain(i18n.t("settings.cliOfficial"));
      expect(text).not.toContain(i18n.t("settings.cliChannels"));
      expect(radios().length).toBe(1);
    });
  });
});
