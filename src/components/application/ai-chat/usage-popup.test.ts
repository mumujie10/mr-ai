import { describe, expect, it } from "vitest";
import type { UsageRow } from "@/lib/ipc";
import { aggregateUsage, usageByDay } from "./usage-popup-dialog";

const row = (overrides: Partial<UsageRow>): UsageRow => ({
  day: "2026-10-10",
  engine: "mireai",
  model: "MiniMax-M3",
  input: 100,
  output: 40,
  cacheRead: 5_000,
  cacheWrite: 1_200,
  requests: 3,
  ...overrides,
});

describe("aggregateUsage", () => {
  it("keeps cache tokens out of the headline total", () => {
    const totals = aggregateUsage([row({}), row({ input: 200, output: 60, requests: 2 })]);
    expect(totals).toEqual({ requests: 5, input: 300, output: 100, total: 400 });
  });

  it("reports nothing for an empty ledger", () => {
    expect(aggregateUsage([])).toEqual({ requests: 0, input: 0, output: 0, total: 0 });
  });
});

describe("usageByDay", () => {
  it("buckets per day, newest first, and folds cache tokens out of the bars", () => {
    const days = usageByDay([
      row({ day: "2026-10-09", input: 10, output: 5 }),
      row({ day: "2026-10-10", input: 7, output: 3 }),
      row({ day: "2026-10-09", input: 1, output: 1, engine: "codex" }),
    ]);
    expect(days).toEqual([
      { day: "2026-10-10", total: 10 },
      { day: "2026-10-09", total: 17 },
    ]);
  });
});
