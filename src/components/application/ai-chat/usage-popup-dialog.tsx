"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ipc, type UsageRow } from "@/lib/ipc";

/**
 * 「我的用量」card behind the sidebar footer's gauge button: an anchored
 * dropdown card (opens from the button, closes on outside press or the ×),
 * not a centered modal — mirroring the reference design's quota card.
 *
 * Content is the local usage ledger (per day/engine/model token buckets)
 * over the last 7 days, aggregated into a headline total and a per-day bar
 * list. This is deliberately NOT the vendor's plan-quota card: with BYOK
 * channels there is no provider-side quota endpoint to ask, so the only
 * honest numbers here are the ones the app measured itself. The
 * 设置 → 用量 page shows the same ledger with charts; this card is the
 * quick glance.
 */

/** Aggregated totals for the card header. */
export interface UsageTotals {
  requests: number;
  input: number;
  output: number;
  /** input + output (cache tokens are excluded: they are read/written
   *  context, not generated traffic, and inflating the headline with them
   *  would overstate spend). */
  total: number;
}

export function aggregateUsage(rows: UsageRow[]): UsageTotals {
  let requests = 0;
  let input = 0;
  let output = 0;
  for (const row of rows) {
    requests += row.requests;
    input += row.input;
    output += row.output;
  }
  return { requests, input, output, total: input + output };
}

/** Per-day totals, newest first — the bar list under the headline. */
export function usageByDay(rows: UsageRow[]): { day: string; total: number }[] {
  const byDay = new Map<string, number>();
  for (const row of rows) {
    byDay.set(row.day, (byDay.get(row.day) ?? 0) + row.input + row.output);
  }
  return [...byDay.entries()]
    .map(([day, total]) => ({ day, total }))
    .sort((a, b) => (a.day < b.day ? 1 : -1));
}

/** Thousands separator; token counts read better grouped. */
const formatTokens = (value: number) => value.toLocaleString();

export function UsagePopupCard() {
  const { t } = useTranslation();
  const [rows, setRows] = useState<UsageRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    // Timezone offset in minutes (JS convention: UTC-local); the Rust side
    // buckets days by it.
    const tzOffsetMinutes = -new Date().getTimezoneOffset();
    ipc
      .usageSummary(7, tzOffsetMinutes)
      .then((summary) => {
        if (alive) setRows(summary);
      })
      .catch((e) => {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      alive = false;
    };
  }, []);

  const totals = useMemo(() => aggregateUsage(rows ?? []), [rows]);
  const days = useMemo(() => usageByDay(rows ?? []), [rows]);
  const peak = Math.max(1, ...days.map((day) => day.total));

  return (
    <div className="flex flex-col gap-3">
      {error !== null ? (
        <p className="text-body-2-regular text-text-tertiary">{error}</p>
      ) : rows === null ? (
        <p className="text-body-2-regular text-text-tertiary">
          {t("usage.popupLoading")}
        </p>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2">
            <UsageStat label={t("usage.popupRequests")} value={formatTokens(totals.requests)} />
            <UsageStat label={t("usage.popupInput")} value={formatTokens(totals.input)} />
            <UsageStat label={t("usage.popupOutput")} value={formatTokens(totals.output)} />
          </div>
          {days.length === 0 ? (
            <p className="text-body-2-regular text-text-tertiary">{t("usage.popupEmpty")}</p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {days.map((day) => (
                <div key={day.day} className="flex items-center gap-2">
                  <span className="w-16 shrink-0 text-caption-1-regular text-text-tertiary">
                    {day.day.slice(5)}
                  </span>
                  <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-background-tertiary-default">
                    <span
                      className="block h-full rounded-full bg-foreground-icon-secondary"
                      style={{ width: `${Math.round((day.total / peak) * 100)}%` }}
                    />
                  </span>
                  <span className="w-16 shrink-0 text-right text-caption-1-regular text-text-secondary">
                    {formatTokens(day.total)}
                  </span>
                </div>
              ))}
            </div>
          )}
          <p className="text-caption-1-regular text-text-tertiary">{t("usage.popupFootnote")}</p>
        </>
      )}
    </div>
  );
}

function UsageStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-background-secondary-default px-2.5 py-2">
      <p className="text-caption-1-regular text-text-tertiary">{label}</p>
      <p className="mt-0.5 truncate text-body-medium text-text-primary" title={value}>
        {value}
      </p>
    </div>
  );
}
