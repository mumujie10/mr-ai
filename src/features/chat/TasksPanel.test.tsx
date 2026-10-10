import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import i18n from "@/lib/i18n";
import type { Message } from "@/lib/ipc";
import { useChatStore } from "./store";
import { TasksPanel } from "./TasksPanel";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const WS = "/tmp/ws";

const msg = (seq: number, role: string, text: string): Message => ({
  seq,
  role,
  text,
  ts: null,
});

function seed(overrides: Record<string, unknown>) {
  useChatStore.setState({
    active: { engine: "mireai", sessionId: "s-1", workspacePath: WS },
    bySession: {
      "mireai/s-1": { messages: [], streaming: true, ...overrides } as never,
    },
  });
}

let container: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  await i18n.changeLanguage("zh");
  useChatStore.setState({ active: null, bySession: {} });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function render(workspacePath = WS) {
  await act(async () => {
    root.render(<TasksPanel workspacePath={workspacePath} />);
  });
}

const tree = {
  rootSessionId: "mireai/s-1",
  members: [
    {
      sessionId: "mvs_child",
      parentSessionId: "mireai/s-1",
      status: "running",
      agentName: "explore",
      task: "数一下 src 下的 .ts",
    },
  ],
};

describe("TasksPanel", () => {
  it("shows the engine's delegation tree instead of the tool-label guess", async () => {
    // The transcript claims "10 parallel fix agents" by tool name; the reported
    // tree says one child. The panel must show the tree, not the claim.
    seed({
      messages: [msg(1, "tool", "task · Dispatching 10 parallel fix agents")],
      delegation: tree,
    });
    await render();
    const panel = container.querySelector('[data-testid="tasks-panel"]');
    expect(panel?.textContent).toContain("数一下 src 下的 .ts");
    expect(panel?.textContent).not.toContain("Dispatching");
    expect(panel?.textContent).toContain(i18n.t("chat.subagentPill"));
    expect(panel?.textContent).toContain(i18n.t("chat.delegationStatusRunning"));
  });

  it("falls back to the heuristic when the engine reported no tree", async () => {
    seed({ messages: [msg(1, "tool", "task · review the relay")] });
    await render();
    expect(
      container.querySelector('[data-testid="tasks-panel"]')?.textContent,
    ).toContain(i18n.t("chat.subagentPill"));
  });

  it("lists the checklist with a completed counter", async () => {
    seed({
      messages: [
        {
          seq: 1,
          role: "tool",
          text: "todo",
          ts: null,
          todos: {
            items: [
              { content: "读代码", status: "complete" },
              { content: "改代码", status: "pending" },
            ],
            replace: true,
          },
        } as Message,
      ],
    });
    await render();
    const panel = container.querySelector('[data-testid="tasks-panel"]');
    expect(panel?.textContent).toContain("读代码");
    expect(panel?.textContent).toContain("1/2");
  });

  it("says what is missing instead of rendering a blank pane", async () => {
    seed({});
    await render();
    expect(container.textContent).toContain(i18n.t("chat.tasksEmpty"));
    expect(container.querySelector('[data-testid="tasks-panel"]')).toBeNull();
  });

  it("stays quiet for another workspace's panel", async () => {
    seed({ delegation: tree });
    await render("/tmp/other");
    expect(container.textContent).toContain(i18n.t("chat.tasksNoSession"));
  });
});
