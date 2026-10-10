import { describe, expect, it } from "vitest";
import { handleEngineEvents } from "./engine-events";
import type { EngineEventPayload } from "@/lib/events";

/**
 * The engine's advertised command catalog (`available_commands_update`):
 * session state the composer's `/` picker reads, not turn output. These tests
 * pin the three things that make it honest — every frame replaces the list,
 * junk entries never reach the picker, and a late frame still counts after the
 * turn it followed has settled.
 */

type CatalogRow = {
  name: string;
  description?: string | null;
  argumentHint?: string | null;
};

function harness(key: string) {
  const state = {
    bySession: {
      [key]: {
        messages: [],
        turnStartedAt: null,
        streaming: true,
        queue: [],
        interrupted: false,
        usage: null,
        error: null,
        engineCommands: undefined as CatalogRow[] | undefined,
        effortLevels: undefined as string[] | undefined,
      },
    },
    openTabs: [],
    models: {},
    efforts: {},
    streamingByKey: {},
    retryingByKey: {},
  };
  const deps = {
    set: (update: (current: typeof state) => Partial<typeof state>) => {
      Object.assign(state, update(state));
    },
    get: () => state,
    drainQueue: () => {},
    markUnseenIfBackground: () => {},
    upsertSessionMeta: () => {},
  };
  return { state, deps };
}

function event(
  runId: string,
  sessionId: string,
  kind: EngineEventPayload["kind"],
  data: unknown,
  seq = 1,
): EngineEventPayload {
  return { runId, sessionId, engine: "mireai", seq, kind, data };
}

function commandsOf(state: ReturnType<typeof harness>["state"], key: string) {
  return state.bySession[key].engineCommands as CatalogRow[] | undefined;
}

describe("engine-advertised slash commands", () => {
  it("stores the whole list and replaces it with the next frame", () => {
    const key = "mireai/session-catalog-1";
    const { state, deps } = harness(key);

    handleEngineEvents(
      [
        event("run-catalog-1", "session-catalog-1", "available_commands", [
          { name: "model" },
          { name: "status" },
        ]),
      ],
      deps as never,
    );
    expect(commandsOf(state, key)?.map((command) => command.name)).toEqual(["model", "status"]);

    // The engine's second frame (after skill discovery) carries its native
    // commands plus the skills: replacing rather than appending is what keeps
    // `/model` listed once and brings `/pdf-tools` in.
    handleEngineEvents(
      [
        event("run-catalog-1", "session-catalog-1", "available_commands", [
          { name: "model", description: "Switch the model", argumentHint: "[provider/model]" },
          { name: "pdf-tools", description: "[Skill] Read PDF files" },
        ]),
      ],
      deps as never,
    );
    expect(commandsOf(state, key)).toEqual([
      { name: "model", description: "Switch the model", argumentHint: "[provider/model]" },
      { name: "pdf-tools", description: "[Skill] Read PDF files", argumentHint: undefined },
    ]);
  });

  it("drops entries the picker cannot type, including repeats", () => {
    const key = "mireai/session-catalog-2";
    const { state, deps } = harness(key);

    handleEngineEvents(
      [
        event("run-catalog-2", "session-catalog-2", "available_commands", [
          { name: "  " },
          { name: "compact" },
          { name: "COMPACT" },
          { name: 42 },
          null,
          { description: "nameless" },
          { name: "skills", description: "  ", argumentHint: "  " },
        ]),
      ],
      deps as never,
    );

    expect(commandsOf(state, key)).toEqual([
      { name: "compact", description: undefined, argumentHint: undefined },
      { name: "skills", description: undefined, argumentHint: undefined },
    ]);
  });

  it("keeps an empty catalog as an answer but ignores a frame that is not a list", () => {
    const key = "mireai/session-catalog-3";
    const { state, deps } = harness(key);

    handleEngineEvents(
      [event("run-catalog-3", "session-catalog-3", "available_commands", [{ name: "model" }])],
      deps as never,
    );
    // A frame that is not a catalog is a protocol surprise, not "the engine has
    // nothing": it must not clear what the picker is already showing.
    handleEngineEvents(
      [event("run-catalog-3", "session-catalog-3", "available_commands", { name: "model" })],
      deps as never,
    );
    expect(commandsOf(state, key)?.map((command) => command.name)).toEqual(["model"]);

    handleEngineEvents(
      [event("run-catalog-3", "session-catalog-3", "available_commands", [])],
      deps as never,
    );
    expect(commandsOf(state, key)).toEqual([]);
  });

  it("accepts a late frame after the turn it followed has settled", () => {
    const key = "mireai/session-catalog-4";
    const runId = "run-catalog-4";
    const { state, deps } = harness(key);

    handleEngineEvents([event(runId, "session-catalog-4", "done", { usage: null })], deps as never);
    // Skill discovery finishes after the turn: the catalog is session state, so
    // the frame still has to reach the picker even though its run is settled.
    handleEngineEvents(
      [event(runId, "session-catalog-4", "available_commands", [{ name: "pdf-tools" }])],
      deps as never,
    );

    expect(commandsOf(state, key)?.map((command) => command.name)).toEqual(["pdf-tools"]);
  });
});

describe("engine-advertised effort levels", () => {
  function levelsOf(state: ReturnType<typeof harness>["state"], key: string) {
    return state.bySession[key].effortLevels as string[] | undefined;
  }

  it("stores the advertised stops and accepts an empty answer", () => {
    const key = "mireai/session-levels-1";
    const { state, deps } = harness(key);

    handleEngineEvents(
      [event("run-levels-1", "session-levels-1", "effort_levels", ["low", "medium", "max"])],
      deps as never,
    );
    expect(levelsOf(state, key)).toEqual(["low", "medium", "max"]);

    // An engine that reports `[]` is answering "this model has no effort knob",
    // which the slider must then stop pretending to have.
    handleEngineEvents(
      [event("run-levels-1", "session-levels-1", "effort_levels", [])],
      deps as never,
    );
    expect(levelsOf(state, key)).toEqual([]);
  });

  it("trims, de-duplicates, and keeps a non-list frame from clearing the list", () => {
    const key = "mireai/session-levels-2";
    const { state, deps } = harness(key);

    handleEngineEvents(
      [
        event("run-levels-2", "session-levels-2", "effort_levels", [
          " low ",
          "low",
          "",
          7,
          null,
          "max",
        ]),
      ],
      deps as never,
    );
    expect(levelsOf(state, key)).toEqual(["low", "max"]);

    handleEngineEvents(
      [event("run-levels-2", "session-levels-2", "effort_levels", { level: "low" })],
      deps as never,
    );
    expect(levelsOf(state, key)).toEqual(["low", "max"]);
  });

  it("accepts the report that follows a model switch after the turn settled", () => {
    const key = "mireai/session-levels-3";
    const runId = "run-levels-3";
    const { state, deps } = harness(key);

    handleEngineEvents([event(runId, "session-levels-3", "done", { usage: null })], deps as never);
    // The CLI re-sends the whole option list when the model changes; that frame
    // is session state and must not be dropped as a late turn event.
    handleEngineEvents(
      [event(runId, "session-levels-3", "effort_levels", ["minimal", "low"])],
      deps as never,
    );
    expect(levelsOf(state, key)).toEqual(["minimal", "low"]);
  });
});
