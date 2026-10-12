/**
 * 一次性标题补全的前端规则（7b）：展示优先级、开场消息的取法与裁剪、
 * 触发的一次性与重试边界（终局结论不再试，其余下一轮再试）。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Message } from "@/lib/ipc";
import { AGENT_BLOCK_HEADER } from "@/features/chat/components/agent-block";

const ipcMock = vi.hoisted(() => ({
  autoTitleSession: vi.fn(),
}));

vi.mock("@/lib/ipc", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ipc")>();
  return { ...actual, ipc: { ...actual.ipc, ...ipcMock } };
});

import {
  noteSessionTurnSettled,
  resetSessionTitleState,
  sessionDisplayTitle,
  sessionTitleChain,
  titleSeed,
  type TitleContext,
} from "./session-title";

function message(role: string, text: string): Message {
  return { seq: 1, role, text, ts: null };
}

function context(overrides: Partial<TitleContext> = {}): TitleContext {
  return {
    key: "claude/s-1",
    engine: "claude",
    sessionId: "s-1",
    providerId: "relay-1",
    model: "claude-sonnet-4-6",
    seed: "帮我看看这个报错",
    ...overrides,
  };
}

const applied = { status: "applied" as const, title: "排查报错", at: Date.now() };

/** 让 noteSessionTurnSettled 里链式的 then/finally 落地。 */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  ipcMock.autoTitleSession.mockReset();
  ipcMock.autoTitleSession.mockResolvedValue(applied);
  resetSessionTitleState();
});

describe("sessionDisplayTitle / sessionTitleChain", () => {
  const base = { customTitle: null, autoTitle: null, title: "首条消息", sessionId: "abcdef1234" };

  it("prefers custom over auto over the scanned title", () => {
    expect(sessionDisplayTitle(base)).toBe("首条消息");
    expect(sessionDisplayTitle({ ...base, autoTitle: "生成的标题" })).toBe("生成的标题");
    expect(
      sessionDisplayTitle({ ...base, autoTitle: "生成的标题", customTitle: "我的名字" }),
    ).toBe("我的名字");
  });

  it("treats blank strings as absent", () => {
    expect(sessionDisplayTitle({ ...base, title: "  ", autoTitle: "  " })).toBe("abcdef12");
    expect(sessionTitleChain({ ...base, title: "" })).toBeNull();
    expect(sessionTitleChain({ ...base, autoTitle: "  " })).toBe("首条消息");
  });
});

describe("titleSeed", () => {
  it("takes the first user message with prose", () => {
    expect(
      titleSeed([
        message("assistant", "你好"),
        message("user", "  "),
        message("user", "帮我看看这个报错"),
      ]),
    ).toBe("帮我看看这个报错");
  });

  it("strips the injected bot block", () => {
    expect(
      titleSeed([
        message("user", `记住项目用 pnpm\n\n${AGENT_BLOCK_HEADER}\n\nAgent Name: 太奶\n\n你是「太奶」。`),
      ]),
    ).toBe("记住项目用 pnpm");
  });

  it("returns null when there is no user prose", () => {
    expect(titleSeed([message("tool", "Read file")])).toBeNull();
  });

  it("caps the seed by characters, not UTF-16 units", () => {
    const seed = titleSeed([message("user", "🐛".repeat(2_500))]);
    expect([...(seed ?? "")].length).toBe(2_000);
    expect(seed?.endsWith("🐛")).toBe(true);
  });
});

describe("noteSessionTurnSettled", () => {
  it("fires once per session and stops after a terminal outcome", async () => {
    noteSessionTurnSettled(context());
    await flush();
    expect(ipcMock.autoTitleSession).toHaveBeenCalledTimes(1);
    // applied 是终局：下一轮不再尝试。
    noteSessionTurnSettled(context());
    await flush();
    expect(ipcMock.autoTitleSession).toHaveBeenCalledTimes(1);
  });

  it("retries on the next turn when the outcome is not terminal", async () => {
    ipcMock.autoTitleSession.mockResolvedValue({
      status: "skipped",
      message: "no_channel",
      at: Date.now(),
    });
    noteSessionTurnSettled(context());
    await flush();
    // 没渠道不是终局：用户配好渠道后，下一轮结算应再试。
    noteSessionTurnSettled(context());
    await flush();
    expect(ipcMock.autoTitleSession).toHaveBeenCalledTimes(2);
  });

  it("does not stack requests for the same session", async () => {
    let resolve!: (outcome: unknown) => void;
    ipcMock.autoTitleSession.mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    noteSessionTurnSettled(context());
    noteSessionTurnSettled(context());
    expect(ipcMock.autoTitleSession).toHaveBeenCalledTimes(1);
    resolve({ status: "skipped", message: "missing", at: Date.now() });
    await flush();
    // missing 不是终局，但同一个会话下一轮换轮次才再试；这里只是确认在途
    // 标记已释放（不会永远挡住这个会话）。
    noteSessionTurnSettled(context());
    await flush();
    expect(ipcMock.autoTitleSession).toHaveBeenCalledTimes(2);
  });

  it("treats a rejected call as retryable, not terminal", async () => {
    ipcMock.autoTitleSession.mockRejectedValue(new Error("ipc down"));
    noteSessionTurnSettled(context());
    await flush();
    noteSessionTurnSettled(context());
    await flush();
    expect(ipcMock.autoTitleSession).toHaveBeenCalledTimes(2);
  });
});
