import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionMeta } from "@/lib/ipc";
import { useConversationMode } from "./conversation-mode";
import {
  closeSessionsOutsideMode,
  installModeSessionSync,
} from "./mode-session-sync";
import { useChatStore } from "./store";
import { registerSessionHooks } from "@/features/plugins/runtime/hooks";

vi.mock("@/lib/ipc", () => ({
  ipc: {
    sendMessage: vi.fn(async () => ({ runId: "run-1", sessionId: null })),
    interruptSession: vi.fn(async () => true),
    rememberSessionModel: vi.fn(async () => {}),
    rememberSessionEffort: vi.fn(async () => {}),
    rememberSessionScope: vi.fn(async () => {}),
    listSessions: vi.fn(async () => []),
    listArchivedSessions: vi.fn(async () => []),
    listPlanReviews: vi.fn(async () => []),
    archiveSession: vi.fn(async () => {}),
    restoreSession: vi.fn(async () => {}),
    loadSessionPage: vi.fn(async () => ({ messages: [], nextBefore: null, subagentHistory: [] })),
    loadRemoteSessionPage: vi.fn(async () => ({ messages: [], nextBefore: null, subagentHistory: [] })),
    deleteSession: vi.fn(async () => {}),
    deleteRemoteSession: vi.fn(async () => {}),
    getAppSettings: vi.fn(async () => ({})),
    updateAppSettings: vi.fn(async () => {}),
    rescanSessions: vi.fn(async () => {}),
    listEngines: vi.fn(async () => []),
  },
}));
vi.mock("@/lib/events", () => ({
  listenEngineEvents: vi.fn(async () => () => {}),
  listenSessionsChanged: vi.fn(async () => () => {}),
  listenComputerUseEscape: vi.fn(async () => () => {}),
}));

const WS = "/tmp/ws";

function sess(id: string) {
  return { engine: "omp", sessionId: id, workspacePath: WS };
}

function meta(sessionId: string, scope?: string | null): SessionMeta {
  return {
    engine: "omp",
    sessionId,
    workspacePath: WS,
    filePath: "",
    fileSize: 0,
    fileMtimeMs: 0,
    title: sessionId,
    preview: "",
    createdAt: 1,
    updatedAt: 2,
    messageCount: 1,
    pinned: false,
    customTitle: null,
    scope,
  };
}

beforeEach(() => {
  localStorage.clear();
  useChatStore.setState({
    openTabs: [],
    active: null,
    sessions: [],
    bySession: {},
    unseen: {},
    drafts: {},
    sessionContributions: {},
    streamingByKey: {},
    retryingByKey: {},
  });
  // 先清页签再摆形态：这个 setState 会触发现有订阅，空列表下收拢是空操作。
  useConversationMode.setState({ mode: "work" });
  installModeSessionSync();
});

describe("closeSessionsOutsideMode", () => {
  it("切到对话：工作会话关掉，激活落到留下的对话会话", async () => {
    const work = sess("s-work");
    const chat = sess("s-chat");
    useChatStore.setState({
      openTabs: [work, chat],
      active: work,
      sessions: [meta("s-work"), meta("s-chat", "chat")],
    });

    useConversationMode.getState().setMode("chat");

    const s = useChatStore.getState();
    expect(s.openTabs).toEqual([chat]);
    expect(s.active).toMatchObject({ sessionId: "s-chat" });
  });

  it("切回工作：对话会话关掉，没剩下任何会话时中心区回到空态", () => {
    const chat = sess("s-chat");
    useChatStore.setState({
      openTabs: [chat],
      active: chat,
      sessions: [meta("s-chat", "chat")],
    });
    useConversationMode.getState().setMode("chat");

    useConversationMode.getState().setMode("work");

    const s = useChatStore.getState();
    expect(s.openTabs).toEqual([]);
    expect(s.active).toBeNull();
  });

  it("草稿跟随当前形态，不随切换关掉", () => {
    const draft = { engine: "omp", sessionId: null, workspacePath: WS };
    const work = sess("s-work");
    useChatStore.setState({
      openTabs: [draft, work],
      active: draft,
      sessions: [meta("s-work")],
    });

    useConversationMode.getState().setMode("chat");

    const s = useChatStore.getState();
    expect(s.openTabs).toEqual([draft]);
    expect(s.active).toMatchObject({ sessionId: null });
  });

  it("没有出生标识的老会话按工作算：对话下关掉、工作下保留", () => {
    const legacy = sess("s-legacy");
    useChatStore.setState({
      openTabs: [legacy],
      active: legacy,
      sessions: [meta("s-legacy", null)],
    });

    useConversationMode.getState().setMode("chat");
    expect(useChatStore.getState().openTabs).toEqual([]);

    useChatStore.setState({ openTabs: [legacy], active: legacy });
    useConversationMode.getState().setMode("work");
    expect(useChatStore.getState().openTabs).toEqual([legacy]);
  });

  it("列表里查不到的页签也按工作算（与侧栏同一套规则）", () => {
    const unknown = sess("s-unknown");
    useChatStore.setState({ openTabs: [unknown], active: unknown, sessions: [] });

    closeSessionsOutsideMode("chat");

    expect(useChatStore.getState().openTabs).toEqual([]);
  });

  it("形态没变时不动任何页签", () => {
    const work = sess("s-work");
    useChatStore.setState({
      openTabs: [work],
      active: work,
      sessions: [meta("s-work")],
    });

    useConversationMode.getState().setMode("work");

    expect(useChatStore.getState().openTabs).toEqual([work]);
    expect(useChatStore.getState().active).toMatchObject({ sessionId: "s-work" });
  });

  it("installModeSessionSync 幂等：重复安装不会把关闭事件发多次", async () => {
    const closed = vi.fn();
    const dispose = registerSessionHooks("test.mode-sync-count", {
      onClosed: closed,
    });
    try {
      installModeSessionSync();
      installModeSessionSync();
      const work = sess("s-work");
      useChatStore.setState({
        openTabs: [work],
        active: work,
        sessions: [meta("s-work")],
      });

      useConversationMode.getState().setMode("chat");
      await Promise.resolve();

      expect(useChatStore.getState().openTabs).toEqual([]);
      expect(closed).toHaveBeenCalledTimes(1);
    } finally {
      dispose();
    }
  });
});
