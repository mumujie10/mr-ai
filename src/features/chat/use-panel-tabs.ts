import { useMemo } from "react";
import {
  compareByOrder,
  panelTabRegistry,
  useRegistry,
  type PanelTabDef,
} from "@ccgui/plugin-sdk";
import { useConversationMode } from "./conversation-mode";

/** Registry entries in display order (compareByOrder: undefined order sorts
 *  last, ties by id). Shared by ChatPanelHeader's pills and ChatSidePanel's
 *  panels so both always agree on tab order. 对话模式下任务页签整个撤下
 *  （子代理/任务清单是工作形态的监控面），插件页签不受影响。 */
export function useSortedPanelTabs(): PanelTabDef[] {
  const tabs = useRegistry(panelTabRegistry);
  const mode = useConversationMode((s) => s.mode);
  return useMemo(
    () =>
      [...tabs]
        .filter((tab) => mode === "work" || tab.id !== "tasks")
        .sort(compareByOrder),
    [tabs, mode],
  );
}

/** Read-side fallback for the persisted active tab: a plugin tab can vanish
 *  (plugin unloaded/quarantined) while its id stays in layout state, which
 *  would hide every panel and blank the sidebar. Resolve to the first tab
 *  instead. Deliberately NOT written back — the stale id re-resolves if the
 *  plugin returns. */
export function resolveActivePanelTab(
  tabs: PanelTabDef[],
  activeId: string,
): string | undefined {
  if (tabs.some((tab) => tab.id === activeId)) return activeId;
  return tabs[0]?.id;
}
