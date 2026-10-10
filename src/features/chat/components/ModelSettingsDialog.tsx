"use client";

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  Slider as AriaSlider,
  SliderThumb as AriaSliderThumb,
  SliderTrack as AriaSliderTrack,
} from "react-aria-components";
import { ModalShell } from "@/components/dialogs";
import { Select, SelectItem } from "@/components/base/select/select";
import { Switch } from "@/components/base/switch/switch";
import { CLI_DISPLAY_NAMES } from "@/components/foundations/icons/engine-brands";
import { EngineIcon } from "@/components/foundations/icons/engine-icon";
import { cx } from "@/utils/cx";
import {
  EFFORT_LEVELS,
  effortLabel,
  supportsEffort,
  type EffortLevel,
} from "@/components/application/ai-chat/effort-levels";
import type { ModelOption } from "@/components/application/ai-chat/cli-menu";
import {
  hiddenModelIds,
  modelSettingFor,
  useModelSettings,
} from "@/features/chat/model-settings";

/**
 * 模型设置 — per-model overrides for one engine: a default thinking level, a
 * context window, and whether the row appears in the picker. Opened from the
 * model panel's gear button.
 *
 * Rows are keyed by the picker's model id, which already carries the channel
 * (`llm/MiniMax-M3` for a BYOK channel, `minimax/MiniMax-M3` for the bundled
 * runtime's own), so 官方配置 and each vendor channel are separate rows — that
 * is what "给这个引擎的官方配置和供应商渠道分别设置" means in storage.
 *
 * Every change applies immediately: a per-row control that needs a separate
 * 保存 step reads as broken the moment someone closes the dialog after moving
 * one slider, and the half-applied state is invisible. The footer states when a
 * change takes effect instead of pretending to buffer it.
 */

/** Fixed windows offered per model. `auto` (index 0) deletes the override —
 *  clearing has to be as easy as setting. */
const CONTEXT_STOPS = [200_000, 400_000, 1_000_000];

const formatWindow = (tokens: number) =>
  tokens >= 1_000_000 ? "1M" : `${Math.round(tokens / 1000)}K`;

function ContextWindowSlider({
  value,
  onChange,
  ariaLabel,
}: {
  value: number | undefined;
  onChange: (next: number | undefined) => void;
  ariaLabel: string;
}) {
  const { t } = useTranslation();
  const levels = useMemo(
    () => [t("chat.modelContextAuto"), ...CONTEXT_STOPS.map(formatWindow)],
    [t],
  );
  const known = value ? CONTEXT_STOPS.indexOf(value) : -1;
  // A stored window the stops no longer offer (a hand-edited settings file)
  // keeps the thumb on the nearest real stop instead of inventing a position.
  const index = known >= 0 ? known + 1 : value ? levels.length - 1 : 0;
  const fraction = index / (levels.length - 1);
  return (
    <AriaSlider
      aria-label={ariaLabel}
      minValue={0}
      maxValue={levels.length - 1}
      step={1}
      value={index}
      onChange={(next) => {
        const i = next as number;
        onChange(i === 0 ? undefined : CONTEXT_STOPS[i - 1]);
      }}
      className="w-full"
    >
      <div className="relative h-[27px] w-full overflow-hidden rounded-lg bg-background-secondary-default">
        <div
          className="absolute inset-y-0 left-0 rounded-lg bg-background-tertiary-hover transition-[width] duration-150 ease-out"
          style={{ width: `calc(${fraction} * (100% - 21px) + 21px)` }}
        />
        <div className="absolute inset-x-[9px] top-[7px] flex h-[13px] items-center justify-between">
          {levels.map((level, i) => (
            <span
              key={level}
              aria-hidden
              className={cx(
                "h-full w-[3px] rounded-[2px] bg-foreground-icon-tertiary transition-opacity duration-150",
                i > index && "opacity-30",
              )}
            />
          ))}
        </div>
        <div className="absolute inset-x-[10.5px] inset-y-0">
          <AriaSliderTrack className="h-full w-full">
            <AriaSliderThumb className="top-1/2 h-[27px] w-[21px] cursor-grab rounded-[7px] border border-border-checkbox-default bg-background-primary-default shadow-xs outline-none transition-shadow data-[dragging]:cursor-grabbing data-[focus-visible]:ring-2 data-[focus-visible]:ring-border-focus-ring" />
          </AriaSliderTrack>
        </div>
      </div>
      <div className="mt-1 flex justify-between text-caption-2-regular text-text-tertiary">
        <span>{value ? formatWindow(value) : t("chat.modelContextAuto")}</span>
        <span>1M</span>
      </div>
    </AriaSlider>
  );
}

export function ModelSettingsDialog({
  engineId,
  models,
  effortLevels,
  onClose,
}: {
  engineId: string;
  /** The rows the picker shows (labels come from the engine's catalog). */
  models: ModelOption[];
  /** Levels the engine reported for the model this session runs. Missing =
   *  not reported (offer the app's fixed stops); empty = no knob at all. */
  effortLevels?: string[] | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const byKey = useModelSettings((s) => s.byKey);
  const update = useModelSettings((s) => s.update);
  const engineName = CLI_DISPLAY_NAMES[engineId] ?? engineId;
  const hasEffortKnob = supportsEffort(engineId) && (effortLevels?.length ?? 1) > 0;
  const stops = effortLevels && effortLevels.length > 0 ? effortLevels : [...EFFORT_LEVELS];
  // Hidden rows are not in `models` (the picker drops them) — read them back
  // out of the same map the rows are judged by, so there is one source of
  // truth for "is this row hidden" and undoing a hide cannot drift.
  const hiddenIds = useMemo(() => hiddenModelIds(byKey, engineId), [byKey, engineId]);

  const rows = useMemo<ModelOption[]>(() => {
    const seen = new Set(models.map((m) => m.id));
    return [
      ...models,
      // A hidden row keeps the id as its label: the catalog it came from is
      // not on screen any more, and inventing a prettier name would hide which
      // one it is.
      ...hiddenIds
        .filter((id) => !seen.has(id))
        .map((id) => ({ id, label: id.split("/").pop() ?? id })),
    ];
  }, [models, hiddenIds]);

  return (
    <ModalShell
      label={t("chat.modelSettings")}
      onClose={onClose}
      className="w-[min(880px,94vw)]"
      dialogClassName="flex max-h-[86vh] flex-col outline-none"
    >
      <div className="flex shrink-0 items-center gap-2 pb-3">
        <EngineIcon engine={engineId} size={18} className="shrink-0" />
        <span className="min-w-0 flex-1 truncate text-body-large text-text-primary">
          {t("chat.modelSettings")}
          <span className="ml-2 text-body-2-regular text-text-tertiary">{engineName}</span>
        </span>
      </div>

      <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">
        {rows.length === 0 ? (
          <p className="py-6 text-center text-body-2-regular text-text-tertiary">
            {t("chat.modelSettingsEmpty")}
          </p>
        ) : (
          <div className="flex flex-col">
            <div className="grid grid-cols-[minmax(0,1fr)_150px_72px_200px] items-center gap-3 border-b border-separator-border pb-2 text-caption-1-regular text-text-tertiary">
              <span>{t("chat.modelSettingsColumn")}</span>
              <span>{t("chat.modelEffortColumn")}</span>
              <span className="text-center">{t("chat.modelVisibilityColumn")}</span>
              <span>{t("chat.modelContextColumn")}</span>
            </div>
            {rows.map((row) => {
              const setting = modelSettingFor(byKey, engineId, row.id);
              const hidden = setting?.hidden === true;
              return (
                <div
                  key={row.id}
                  className="grid grid-cols-[minmax(0,1fr)_150px_72px_200px] items-center gap-3 border-b border-separator-border py-3 last:border-b-0"
                >
                  <span className="min-w-0">
                    <span
                      className={cx(
                        "block truncate text-body-medium",
                        hidden ? "text-text-tertiary" : "text-text-primary",
                      )}
                    >
                      {row.label}
                    </span>
                    <span className="block truncate text-caption-2-regular text-text-tertiary">
                      {row.provider ?? row.id}
                      {hidden ? ` · ${t("chat.modelHidden")}` : ""}
                    </span>
                  </span>

                  {hasEffortKnob ? (
                    <Select
                      size="sm"
                      aria-label={`${t("chat.modelEffortColumn")} · ${row.label}`}
                      selectedKey={setting?.effort ?? "follow"}
                      onSelectionChange={(key) =>
                        update(engineId, row.id, {
                          effort: key === "follow" ? undefined : String(key),
                        })
                      }
                    >
                      <SelectItem id="follow">{t("chat.modelEffortFollowEngine")}</SelectItem>
                      {stops.map((level) => (
                        <SelectItem key={level} id={level}>
                          {effortLabel(level as EffortLevel, t)}
                        </SelectItem>
                      ))}
                    </Select>
                  ) : (
                    <span className="text-body-2-regular text-text-tertiary">
                      {t("chat.effortNoneForModel")}
                    </span>
                  )}

                  <span className="flex justify-center">
                    <Switch
                      size="sm"
                      aria-label={`${t("chat.modelVisibilityColumn")} · ${row.label}`}
                      isSelected={!hidden}
                      onChange={(next) =>
                        update(engineId, row.id, { hidden: !next })
                      }
                    />
                  </span>

                  <ContextWindowSlider
                    ariaLabel={`${t("chat.modelContextColumn")} · ${row.label}`}
                    value={setting?.contextWindow}
                    onChange={(next) =>
                      update(engineId, row.id, { contextWindow: next })
                    }
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-3 pt-3">
        <p className="min-w-0 flex-1 text-caption-1-regular text-text-tertiary">
          {t("chat.modelSettingsHint")}
        </p>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 cursor-pointer rounded-lg border border-border-button-default bg-background-primary-default px-3 py-1.5 text-body-2-medium text-text-primary transition-colors hover:bg-background-primary-hover"
        >
          {t("common.close")}
        </button>
      </div>
    </ModalShell>
  );
}
