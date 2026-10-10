import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ipc", () => ({
  ipc: {
    // The footer's remote-control badge reads this on mount.
    remoteControlActive: vi.fn(async () => false),
    usageSummary: vi.fn(async () => [
      {
        day: "2026-10-10",
        engine: "mireai",
        model: "MiniMax-M3",
        input: 100,
        output: 50,
        cacheRead: 0,
        cacheWrite: 0,
        requests: 2,
      },
      {
        day: "2026-10-09",
        engine: "mireai",
        model: "MiniMax-M3",
        input: 10,
        output: 5,
        cacheRead: 0,
        cacheWrite: 0,
        requests: 1,
      },
    ]),
  },
}));

import { ipc } from "@/lib/ipc";
import { aggregateUsage, usageByDay } from "./usage-popup-dialog";
import { SidebarFooter } from "./sidebar-chrome";

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("usage popup aggregates", () => {
  it("totals input plus output, excluding cache tokens", () => {
    const totals = aggregateUsage([
      { input: 100, output: 50, cacheRead: 1000, cacheWrite: 500, requests: 2 },
      { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, requests: 1 },
    ] as never[]);
    expect(totals).toEqual({ requests: 3, input: 110, output: 55, total: 165 });
  });

  it("folds rows into per-day totals, newest first", () => {
    const days = usageByDay([
      { day: "2026-10-09", input: 10, output: 5 },
      { day: "2026-10-10", input: 100, output: 50 },
      { day: "2026-10-10", input: 1, output: 1 },
    ] as never[]);
    expect(days).toEqual([
      { day: "2026-10-10", total: 152 },
      { day: "2026-10-09", total: 15 },
    ]);
  });
});

describe("sidebar footer cluster", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.mocked(ipc.usageSummary).mockClear();
  });

  const render = (onOpenSettings?: (page?: string) => void) =>
    act(async () => {
      root.render(<SidebarFooter onOpenSettings={onOpenSettings} />);
    });

  it("shows the placeholder account block", async () => {
    await render();
    expect(container.textContent).toContain("徐磊");
    expect(container.textContent).toContain("徐");
  });

  it("the gauge opens the local usage popup with real ledger numbers", async () => {
    await render();
    await act(async () => {
      container.querySelector<HTMLButtonElement>(
        'button[aria-label="我的用量"]',
      )!.click();
    });
    await act(async () => {});
    expect(vi.mocked(ipc.usageSummary)).toHaveBeenCalled();
    // The dialog portals to document.body.
    // 110 input + 55 output from the mocked rows.
    expect(document.body.textContent).toContain("我的用量");
    expect(document.body.textContent).toContain("110");
    expect(document.body.textContent).toContain("55");
  });

  it("the gear menu deep-links each section", async () => {
    const onOpenSettings = vi.fn();
    await render(onOpenSettings);
    await act(async () => {
      container.querySelector<HTMLButtonElement>(
        'button[aria-label="设置"]',
      )!.click();
    });
    await act(async () => {});
    // DropdownItems are plain buttons inside the portalled popover, scoped
    // by its aria-label.
    const popover = document.body.querySelector('[aria-label="快捷菜单"]');
    expect(popover).not.toBeNull();
    const items = [
      ...popover!.querySelectorAll<HTMLButtonElement>("button"),
    ];
    const labels = items.map((item) => item.textContent?.trim());
    // 设置 leads; the rest are deep links.
    expect(labels).toEqual(["设置", "用量", "桌面宠物", "检查更新"]);
    await act(async () => {
      items.find((item) => item.textContent === "桌面宠物")!.click();
    });
    expect(onOpenSettings).toHaveBeenCalledWith("pet");
  });
});
