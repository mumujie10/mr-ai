import { useConversationMode, type ConversationMode } from "./conversation-mode";
import { useChatStore } from "./store";
import { inConversationMode } from "./thread-scope";

/** 形态切换时把不属于新形态的会话页签关掉：对话/工作是全局形态，切过去时
 *  另一个形态的对话不该留在中心区（分屏里对应的格子随后一并收起，见
 *  split/store.ts 的对齐规则）。草稿（sessionId 为 null）跟随当前形态，
 *  不关——它还没出生，首条发送时才按当时的形态打标。 */
export function closeSessionsOutsideMode(mode: ConversationMode): void {
  const { openTabs, sessions, closeTab } = useChatStore.getState();
  for (const tab of openTabs) {
    if (tab.sessionId === null) continue;
    const meta = sessions.find(
      (m) =>
        m.engine === tab.engine &&
        m.sessionId === tab.sessionId &&
        m.workspacePath === tab.workspacePath,
    );
    // 列表里查不到的老页签按工作算（与 thread-scope 同一套规则）。
    if (inConversationMode(meta?.scope, mode)) continue;
    closeTab(tab.engine, tab.sessionId, tab.workspacePath);
  }
}

let installed = false;

/** 订阅形态 store：模式一变就收拢会话页签。幂等（与 installSplitSync 同款，
 *  订阅活在模块里，卸载不解除）。 */
export function installModeSessionSync(): void {
  if (installed) return;
  installed = true;
  let lastMode = useConversationMode.getState().mode;
  useConversationMode.subscribe((state) => {
    if (state.mode === lastMode) return;
    lastMode = state.mode;
    closeSessionsOutsideMode(state.mode);
  });
}
