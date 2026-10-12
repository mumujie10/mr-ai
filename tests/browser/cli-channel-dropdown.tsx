// Open /tests/browser/cli-channel-dropdown.html with the Vite dev server
// running. Mounts the real CliMenu with Claude first and Codex active, plus
// a dozen providers. Checks the bounded dropdown and that choosing a focused
// channel keeps Codex's panel open instead of falling back to Claude's row.
// Reports PASS/FAIL plus measured heights and focus. No app, no backend.
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { CliMenu, type EffortLevel } from "../../src/components/application/ai-chat/cli-menu";
import type { ChannelOption } from "../../src/components/application/ai-chat/engine-model-panel";
import "../../src/index.css";
import "../../src/lib/i18n";

/** The reported machine: a dozen relays beside the runtime's own 官方配置. */
const CHANNELS: ChannelOption[] = [
  { id: "local", label: "官方配置", kind: "official" },
  { id: "motomoto", label: "motomoto", kind: "custom" },
  { id: "ly", label: "LY gpt", kind: "custom" },
  { id: "g2a", label: "g2a", kind: "custom" },
  { id: "cpa", label: "cpa", kind: "custom" },
  { id: "agentrouter", label: "agentrouter", kind: "custom" },
  { id: "gorouter", label: "gorouter", kind: "custom" },
  { id: "mint", label: "薄荷", kind: "custom" },
  { id: "tabletoken", label: "tabletoken", kind: "custom" },
  { id: "zen2api", label: "zen2api", kind: "custom" },
  { id: "tg", label: "TG", kind: "custom" },
  { id: "anyrouter", label: "anyrouter 共享", kind: "custom" },
];

/** Channel names that must NOT be visible while the dropdown is collapsed. */
const COLLAPSED_HIDDEN = ["agentrouter", "anyrouter 共享", "tabletoken"];

/** A hidden tab (automated / background browser) never fires rAF, so the paint
 *  flush falls back to a timer — layout still resolves on demand, which is all
 *  the measurements below need. */
const frame = () =>
  new Promise<void>((resolve) =>
    document.hidden ? setTimeout(resolve, 32) : requestAnimationFrame(() => resolve()),
  );
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Poll for a condition instead of guessing at animation timings. */
async function waitFor<T>(get: () => T | null | undefined, what: string, timeoutMs = 4000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = get();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await sleep(50);
  }
}

/** Written by the callback, read by the probe: React state here would re-run
 *  the effect (and re-toggle the menu) the moment a channel is picked. */
const observed = { picked: "" };

function Test() {
  const [engine, setEngine] = useState("codex");
  const [channel, setChannel] = useState(CHANNELS[0].id);
  const [effort, setEffort] = useState<EffortLevel>("medium");
  useEffect(() => {
    let cancelled = false;
    async function run() {
      await document.fonts.ready;
      document.querySelector<HTMLButtonElement>("[data-trigger] button")!.click();
      const codexRow = await waitFor(
        () => [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')]
          .find((button) => button.textContent?.trim() === "Codex CLI"),
        "the Codex engine row",
      );
      codexRow.click();

      // The composer's own CLI chip also carries aria-expanded; the channel
      // trigger is the one showing the selected channel (fixture data).
      const channelTrigger = await waitFor(
        () =>
          [...document.querySelectorAll<HTMLButtonElement>("button[aria-expanded]")].find(
            (button) => button.textContent?.includes(CHANNELS[0].label),
          ),
        "the channel dropdown trigger",
      );
      // The flyout card itself (`data-engine-flyout`), not an `absolute`
      // wrapper: react-aria positions its popover with inline styles, so no
      // `absolute` class exists to walk up to — measuring the card is what
      // this fixture is about anyway.
      const flyout = channelTrigger.closest<HTMLElement>("[data-engine-flyout]");
      if (!flyout) throw new Error("channel trigger is not inside the flyout card");
      await sleep(400);
      await frame();
      if (cancelled) return;

      const text = () => flyout.textContent ?? "";
      const channelRows = () =>
        flyout.querySelectorAll<HTMLElement>('[aria-label="渠道"] [role="radio"]');

      const collapsed = {
        triggerText: channelTrigger.textContent ?? "",
        visibleProviders: COLLAPSED_HIDDEN.filter((name) => text().includes(name)),
        rows: channelRows().length,
        panelHeight: Math.round(flyout.getBoundingClientRect().height),
      };

      channelTrigger.click();
      const list = await waitFor(
        () => flyout.querySelector<HTMLElement>('[aria-label="渠道"]'),
        "the opened channel list",
      );
      await frame();
      if (cancelled) return;

      const opened = {
        rows: channelRows().length,
        clientHeight: Math.round(list.clientHeight),
        scrollHeight: Math.round(list.scrollHeight),
        panelHeight: Math.round(flyout.getBoundingClientRect().height),
        providerCaption: text().includes("供应商渠道"),
        // 官方配置 stays an ordinary selectable row beside the relays: the two
        // are different things and neither one switches the other off.
        officialTag: [...channelRows()]
          .find((row) => row.textContent?.trim().startsWith("官方配置"))
          ?.tagName.slice(0, 20),
        explainsNothing: !text().includes("未配置"),
      };

      // Header filter: the panel's own field narrows the channel list and
      // holds it open while it holds text.
      channelTrigger.click();
      const filter = await waitFor(
        () => flyout.querySelector<HTMLInputElement>("input"),
        "the header channel filter",
      );
      const type = (value: string) => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
        setter.call(filter, value);
        filter.dispatchEvent(new Event("input", { bubbles: true }));
      };
      type("agentrouter");
      const filtered = await waitFor(
        () => (channelRows().length === 1 ? { rows: channelRows().length } : null),
        "the filter to narrow the list to one channel",
      );
      const filteredText = Array.from(channelRows()).map((row) => row.textContent?.trim());
      if (cancelled) return;

      const pick = [...flyout.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
        button.textContent?.trim().startsWith("agentrouter"),
      )!;
      // Native activation focuses the row. A bare click misses the bug where
      // unmounting it lets the overlay restore focus to the first engine row.
      pick.focus();
      pick.click();
      await waitFor(
        () => (channelRows().length === 0 ? true : null),
        "the channel list to close",
      );
      await frame();
      if (cancelled) return;

      const closed = {
        picked: observed.picked,
        rows: channelRows().length,
        triggerText: channelTrigger.textContent ?? "",
        filterCleared: filter.value === "",
        panelHeight: Math.round(flyout.getBoundingClientRect().height),
        panelConnected: flyout.isConnected,
        focusReturned: document.activeElement === channelTrigger,
        focusedText: document.activeElement?.textContent?.trim(),
      };

      const pass =
        collapsed.visibleProviders.length === 0 &&
        collapsed.rows === 0 &&
        opened.rows === CHANNELS.length &&
        opened.clientHeight <= 200 &&
        opened.scrollHeight > opened.clientHeight &&
        opened.providerCaption &&
        opened.officialTag === "BUTTON" &&
        opened.explainsNothing &&
        filtered.rows === 1 &&
        filteredText.length === 1 &&
        filteredText[0] === "agentrouter" &&
        closed.picked === "agentrouter" &&
        closed.rows === 0 &&
        closed.filterCleared &&
        closed.panelConnected &&
        closed.focusReturned &&
        closed.triggerText.includes("agentrouter");
      document.querySelector("#result")!.textContent = JSON.stringify(
        { status: pass ? "PASS" : "FAIL", collapsed, opened, filtered: { rows: filtered.rows, text: filteredText }, closed },
        null,
        2,
      );
    }
    void run().catch((error) => {
      document.querySelector("#result")!.textContent = JSON.stringify({
        status: "ERROR",
        error: String(error),
      });
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return (
    <>
      {/* Anchored to the right: that is where the pill lives in the composer,
          and the popover is right-aligned to it — engine list nearest the pill,
          model flyout to its left, so the row grows leftward. */}
      <div data-trigger style={{ position: "fixed", bottom: 30, right: 40 }}>
        <CliMenu
          options={[
            { id: "claude", label: "Claude Code", available: true },
            { id: "codex", label: "Codex", available: true },
          ]}
          value={engine}
          onChange={setEngine}
          modelsByEngine={{
            claude: [{ id: "", label: "Default" }],
            codex: [
              { id: "", label: "Default", description: "Use the default model" },
              { id: "gpt-5.4", label: "gpt-5.4" },
            ],
          }}
          models={{ codex: "" }}
          onModelChange={() => {}}
          efforts={{ codex: effort }}
          onEffortChange={(_, level) => setEffort(level)}
          channelsByEngine={{ codex: CHANNELS }}
          selectedChannels={{ codex: channel }}
          onChannelChange={(_, id) => {
            observed.picked = id;
            setChannel(id);
          }}
          ompServiceTier={null}
          onOmpServiceTierChange={async () => {}}
          codexServiceTier={null}
          onCodexServiceTierChange={async () => {}}
        />
      </div>
    </>
  );
}

createRoot(document.getElementById("root")!).render(<Test />);
