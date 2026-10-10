/**
 * The six stops the app offers by default, plus any level an engine advertises
 * for itself: reasoning vocabulary is model metadata, not this union (an
 * OpenRouter channel can advertise `minimal`, a BYOK channel `default`). Keeping
 * the literals listed keeps autocomplete useful while the picker follows whatever
 * the selected model actually reports.
 */
export type EffortLevel =
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max"
  | "ultra"
  | (string & {});

/** The six effort stops, in slider order (Codex Astra catalog order). */
export const EFFORT_LEVELS: readonly EffortLevel[] = [
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultra",
];

/** i18n label key per effort stop. */
export const EFFORT_LABEL_KEYS: Record<EffortLevel, string> = {
  low: "chat.effortLow",
  medium: "chat.effortMedium",
  high: "chat.effortHigh",
  xhigh: "chat.effortXhigh",
  max: "chat.effortMax",
  ultra: "chat.effortUltra",
};

/** Label for any level: the app's own wording for a known stop, the engine's own
 *  word for anything else. Showing the raw advertised level for an unlisted one
 *  is honest; showing nothing would look like a broken control. */
export function effortLabel(level: EffortLevel, t: (key: string) => string): string {
  const known = (EFFORT_LABEL_KEYS as Record<string, string>)[level];
  return known ? t(known) : level;
}

/** Stops the trigger pill stacks for width: the app's fixed list when the stored
 *  level is one of them, otherwise that level alone. An engine-advertised name
 *  (`minimal`, `default`) has no sibling to reserve against, and leaving it out
 *  of the stack would render the pill's effort part blank. */
export function pillEffortStops(level: EffortLevel): EffortLevel[] {
  return (EFFORT_LEVELS as readonly string[]).includes(level)
    ? [...EFFORT_LEVELS]
    : [level];
}

/** Stops the slider should render, or `null` when there is nothing to offer:
 *  the engine's advertised levels in its own order once it has reported, the
 *  app's fixed list before the first report, and `null` when the model declares
 *  no effort knob at all — a slider with zero real stops is worse than a line
 *  saying the model does not have one. */
export function effortChoices(
  advertised: string[] | null | undefined,
): string[] | null {
  if (advertised === null || advertised === undefined) return [...EFFORT_LEVELS];
  return advertised.length > 0 ? [...advertised] : null;
}

/** Engines known to support reasoning effort configuration (all supported engines). */export const EFFORT_SUPPORTED_ENGINES: Record<string, true> = {
  claude: true,
  codex: true,
  omp: true,
  pi: true,
  agy: true,
  qoder: true,
  "qoder-cn": true,
  grok: true,
  opencode: true,
  kimi: true,
  dsh: true,
  mireai: true,
  minimax: true,
};

export function supportsEffort(
  engineId: string,
  engines?: { id: string; supportsEffort?: boolean }[],
): boolean {
  const found = engines?.find((e) => e.id === engineId);
  if (found && typeof found.supportsEffort === "boolean") {
    return found.supportsEffort;
  }
  return Boolean(EFFORT_SUPPORTED_ENGINES[engineId] ?? true);
}
