import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { cx } from "@/utils/cx";
import type { Message } from "@/lib/ipc";
import { useChatStore } from "./store";
import { sessionKey } from "./store/persistence";
import {
  deriveAgentTaskSteps,
  deriveTodoList,
  stepsFromDelegation,
} from "./components/agent-task-steps";
import { SubagentRows, TodoRows } from "./components/RunStatusStrip";

const EMPTY_MESSAGES: Message[] = [];

/**
 * 任务 panel — what this conversation delegated, and the checklist the engine
 * is working through, in the right panel.
 *
 * Same source as the composer's run-status strip, and deliberately the same row
 * components: a status word must not read one way in the strip and another way
 * here. The strip stays what it is (live, above the composer); this panel is the
 * place to watch a longer run while reading files.
 *
 * Subagents prefer the engine's own delegation tree (`mcode/session/delegation_update`)
 * and fall back to the tool-label heuristic when the engine reports none, so an
 * engine that never broadcasts still shows something rather than an empty panel.
 */
export function TasksPanel({ workspacePath }: { workspacePath: string }) {
  const { t } = useTranslation();
  const active = useChatStore((s) => s.active);
  const key = active
    ? sessionKey(active.engine, active.sessionId, active.workspacePath)
    : "";
  const session = useChatStore((s) => (key ? s.bySession[key] : undefined));
  const messages = session?.messages ?? EMPTY_MESSAGES;
  const subagentHistory = session?.subagentHistory ?? EMPTY_MESSAGES;
  const delegation = session?.delegation ?? null;
  const streaming = session?.streaming ?? false;

  const allHistory = useMemo(
    () => (subagentHistory.length ? [...subagentHistory, ...messages] : messages),
    [subagentHistory, messages],
  );
  const steps = useMemo(
    () =>
      delegation
        ? stepsFromDelegation(delegation)
        : deriveAgentTaskSteps(allHistory, streaming, active?.engine ?? ""),
    [delegation, allHistory, streaming, active?.engine],
  );
  const todos = useMemo(() => deriveTodoList(allHistory), [allHistory]);

  if (!active || active.workspacePath !== workspacePath) {
    return (
      <p className="p-4 text-body-2-regular text-text-tertiary">
        {t("chat.tasksNoSession")}
      </p>
    );
  }
  if (steps.length === 0 && todos.length === 0) {
    // Say what is missing rather than showing a blank pane: whether a run
    // reports subagents depends on the engine, so an empty panel is not
    // automatically "nothing happened".
    return (
      <p className="p-4 text-body-2-regular text-text-tertiary">
        {t("chat.tasksEmpty")}
      </p>
    );
  }

  const section = (label: string, count: string, body: React.ReactNode) => (
    <section key={label} className="flex min-h-0 flex-col">
      <h3 className="flex items-center gap-2 px-3 py-2 text-caption-1-regular text-text-tertiary">
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <span className="shrink-0 tabular-nums">{count}</span>
      </h3>
      {body}
    </section>
  );

  return (
    <div
      data-testid="tasks-panel"
      className={cx("flex min-h-0 flex-1 flex-col overflow-y-auto")}
    >
      {steps.length > 0 &&
        section(
          t("chat.subagentPill"),
          `${steps.filter((step) => step.state === "complete").length}/${steps.length}`,
          <SubagentRows steps={steps} />,
        )}
      {todos.length > 0 &&
        section(
          t("chat.todoPill"),
          `${todos.filter((item) => item.status === "complete").length}/${todos.length}`,
          <TodoRows items={todos} live={streaming} />,
        )}
    </div>
  );
}
