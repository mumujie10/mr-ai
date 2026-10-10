import type { ConversationMode } from "@/features/chat/conversation-mode";

/** 会话归属哪个形态（侧栏筛选、搜索面板共用同一套规则）。对话只认显式
 *  chat；工作接住其余——老会话没有 scope（出生于拆形态之前，当时只有工作），
 *  按工作算，默认「工作」形态下升级后列表不会空。草稿尚未发出，跟随当前
 *  形态，由调用方用 isDraft 短路。 */
export function inConversationMode(
  scope: string | null | undefined,
  mode: ConversationMode,
): boolean {
  return mode === "chat" ? scope === "chat" : scope !== "chat";
}
