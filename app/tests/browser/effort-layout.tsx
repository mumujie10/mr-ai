import { useEffect, useState } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { CliMenu, type EffortLevel } from "../../src/components/application/ai-chat/cli-menu";
import { EFFORT_LEVELS } from "../../src/components/application/ai-chat/effort-levels";
import "../../src/index.css";
import "../../src/lib/i18n";

const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
function Test() {
  const [effort, setEffort] = useState<EffortLevel>("low");
  useEffect(() => {
    let cancelled = false;
    async function run() {
      await document.fonts.ready;
      const button = document.querySelector<HTMLButtonElement>("[data-trigger] button")!;
      button.click();
      // Let the popover entrance animation settle before measuring layout.
      await new Promise(resolve => setTimeout(resolve, 500));
      await frame(); await frame();
      const measurements = [];
      for (const level of EFFORT_LEVELS) {
        if (cancelled) return;
        flushSync(() => setEffort(level));
        await frame(); await frame();
        const r = button.getBoundingClientRect();
        const dialog = document.querySelector('[role="dialog"]')?.getBoundingClientRect();
        measurements.push({ level, width: r.width, right: r.right, dialogX: dialog?.x });
      }
      const first = measurements[0];
      const pass = measurements.every(m => Math.abs(m.width - first.width) < 0.5 && Math.abs(m.right - first.right) < 0.5 && m.dialogX !== undefined && Math.abs(m.dialogX - first.dialogX!) < 0.5);
      document.querySelector("#result")!.textContent = JSON.stringify({ status: pass ? "PASS" : "FAIL", measurements }, null, 2);
    }
    void run();
    return () => { cancelled = true; };
  }, []);
  return <><pre id="result">Running…</pre><div data-trigger style={{ position: "fixed", bottom: 30, left: 300 }}>
    <CliMenu options={[{ id: "omp", label: "OMP", available: true }]} value="omp" onChange={() => {}}
      modelsByEngine={{ omp: [{ id: "openai-codex/gpt-5.4", label: "GPT-5.4", provider: "openai-codex" }] }}
      models={{ omp: "openai-codex/gpt-5.4" }} onModelChange={() => {}}
      efforts={{ omp: effort }} onEffortChange={(_, level) => setEffort(level)}
      ompServiceTier={null} onOmpServiceTierChange={async () => {}}
      codexServiceTier={null} onCodexServiceTierChange={async () => {}} />
  </div></>;
}
createRoot(document.getElementById("root")!).render(<Test />);
