# Telemetry

MireAI's bundled CLI ships no usage reporting. Two channels that upstream `minimax-code`
offered are deleted from this fork, not disabled:

- **TUI usage events** — the analytics module, its `telemetry.enabled` switch and its
  `meerkat-reporter` destinations are gone. No event is queued and no request can be made,
  whatever `config.yaml` contains.
- **Runtime performance metrics** — no host wires a shipping reporter, so metric instruments stay
  in-process and are only exposed to local callers; the unused batch client never reaches the built
  bundle (verified with `dist` string checks, see below).

There is no `mr telemetry` command. The whole `telemetry` block is gone from the config schema,
so a leftover `telemetry:` section in an older `config.yaml` is ignored rather than honored, and
`MCODE_DISABLE_TELEMETRY` / `DO_NOT_TRACK` no longer have anything to switch off.

## Automatic error diagnostics

Deleted as well, together with the queue and transport that carried it:

- **TUI incident reports** — `packages/tui/src/observability/incident-reporter.ts` is removed.
  The launcher no longer installs an `uncaughtExceptionMonitor`, no longer writes
  `<dataDir>/v2/observability/cli/incidents/*.json`, and no longer batches pending incidents on
  authentication. Renderer, Runtime-bridge and shutdown failures still reach the user through the
  existing local paths: the `v2/observability` event log, the `[minimax-code] … cleanup failed`
  stderr lines, and the in-TUI warning cells.
- **LLM request-failure reports** — `packages/local-runtime/src/error-reporting/` is removed, so a
  provider request failure is only formatted for the current turn; nothing is buffered or encrypted.

The `/minimax-cloud/api/v1/observability/desktop-errors/batch` endpoint and its regional hosts are
absent from the source tree and from the built bundle, so no configuration key or environment
variable can re-enable a send. `scripts/check-standalone-boundary.mjs` treats those paths as retired.

## Locating the active config file

Builds from this repository use `~/.minimax/config.yaml` (or
`~/.minimax-<profile>/config.yaml` when a profile is selected) unless a data-directory
override is set; see [Accounts and data](installation.md#accounts-and-data).

Server-side retention for any channel is not defined or verified by this repository. Login and
model requests have separate network behavior described in
[TUI capability coverage](tui-capabilities.md); user-submitted feedback uploads are removed from
this fork entirely.
