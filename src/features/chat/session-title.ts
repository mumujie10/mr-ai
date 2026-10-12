/**
 * 会话标题的显示与一次性补全（7b 前端）。
 *
 * 显示：自定义名 → 生成的 autoTitle → 扫描器截的 title → 会话 id 前 8 位。
 * 兼容旧调用点的容错（空白串按没有处理）。
 *
 * 补全：其他引擎（自有命名的交给扫描同步 / CLI）首轮结算后用该引擎的渠道
 * 跑一次轻量调用，把待办式的 `title` 换成贴题的 autoTitle。前端每会话只触发
 * 一次；粗粒度状态收在后端 `AutoTitleOutcome` 里，终局结论（生成过/已命名/
 * 用户重命名）记进 `settled` 不再重试，其余（没渠道、行还没扫到、失败）
 * 留待下一轮结算再试——后端只写一次，重试不会产生第二个标题。
 */

import { ipc, type AutoTitleOutcome, type Message } from "@/lib/ipc";
import { stripAgentBlock } from "@/features/chat/components/agent-block";

/** 展示优先级共用的字段形状（SessionMeta 与 MessageSearchHit 都满足）。 */
export interface SessionTitleParts {
  customTitle?: string | null;
  autoTitle?: string | null;
  title?: string | null;
  sessionId: string;
}

/** 自定义名 → 生成的 autoTitle → 扫描器 title；都没有返回 null。
 *  各调用点仍用自己的兜底（id 前 8 位 / 「新对话」/ 会话状态名）。 */
export function sessionTitleChain(session: SessionTitleParts): string | null {
  const custom = session.customTitle?.trim();
  if (custom) return custom;
  const auto = session.autoTitle?.trim();
  if (auto) return auto;
  const scanned = session.title?.trim();
  return scanned || null;
}

/** 展示用：链上都为空时回落到会话 id 前 8 位。 */
export function sessionDisplayTitle(session: SessionTitleParts): string {
  return sessionTitleChain(session) ?? session.sessionId.slice(0, 8);
}

/** 送给后端的开场消息上限，与 Rust 的 MAX_SEED_CHARS 对齐。 */
const SEED_CHARS = 2_000;

/** 开场消息：第一条有正文的用户消息，去掉注入的 Bot 提示块（标题不该描述
 *  提示词），按字符截到 SEED_CHARS（emoji / 中文不劈半）。 */
export function titleSeed(messages: Message[]): string | null {
  for (const message of messages) {
    if (message.role !== "user") continue;
    const text = stripAgentBlock(message.text).text.trim();
    if (!text) continue;
    const chars = [...text];
    return chars.length > SEED_CHARS
      ? chars.slice(0, SEED_CHARS).join("")
      : text;
  }
  return null;
}

export interface TitleContext {
  /** 会话 key，用于本模块去重。 */
  key: string;
  engine: string;
  sessionId: string;
  providerId: string | null;
  model: string | null;
  seed: string;
}

/** 已有终局结论的会话（生成过 / 用户重命名 / 自有命名），不再尝试。 */
const settled = new Set<string>();
/** 正在跑补全的会话，防止同一会话叠请求。 */
const inFlight = new Set<string>();

/** 终局：再也不会变出别的标题，值得记住。其余（missing/no_channel/busy/
 *  failed/channel_incomplete）留待下一轮结算再试。 */
function isTerminal(outcome: AutoTitleOutcome): boolean {
  if (outcome.status === "applied") return true;
  if (outcome.status !== "skipped") return false;
  return (
    outcome.message === "own_naming" ||
    outcome.message === "exists" ||
    outcome.message === "renamed"
  );
}

/** 一轮对话结束：复用它判断要不要补标题。没有开场消息就跳过（列表还没
 *  装载出第一条用户消息时，下一轮结算再看）。 */
export function noteSessionTurnSettled(ctx: TitleContext): void {
  if (settled.has(ctx.key) || inFlight.has(ctx.key)) return;
  inFlight.add(ctx.key);
  void ipc
    .autoTitleSession({
      engine: ctx.engine,
      sessionId: ctx.sessionId,
      providerId: ctx.providerId,
      model: ctx.model,
      seed: ctx.seed,
    })
    .then((outcome) => {
      if (isTerminal(outcome)) settled.add(ctx.key);
    })
    // 补全失败不打扰对话：下一轮结算再试。
    .catch(() => {})
    .finally(() => inFlight.delete(ctx.key));
}

/** 测试用：清掉进程内的终局与在途标记。 */
export function resetSessionTitleState(): void {
  settled.clear();
  inFlight.clear();
}
