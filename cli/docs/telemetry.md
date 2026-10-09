# Telemetry

MireAI's bundled CLI ships no usage reporting. Two channels that upstream `minimax-code`
offered are deleted from this fork, not disabled:

- **TUI usage events** — the analytics module, its `telemetry.enabled` switch and its
  `meerkat-reporter` destinations are gone. No event is queued and no request can be made,
  whatever `config.yaml` contains.
- **Runtime performance metrics** — the cloud metrics transport behind `telemetry.metrics`
  is gone; metric instruments stay in-process and are only exposed to local callers.

There is no `mr telemetry` command. `telemetry.enabled` and `telemetry.metrics` still parse
from `config.yaml` for compatibility with older files, but they no longer authorize any
outbound request.

## Automatic error diagnostics

The only reporting path that remains is `telemetry.diagnostics`, which is off by default:

```yaml
telemetry:
  diagnostics: false # Account-linked TUI and LLM error diagnostics
```

Setting it to `true` authorizes both TUI incident reports and LLM request-failure reports.
Both additionally require a signed-in account: the transport uses the account's Bearer token
and a `user_id` query parameter, so these reports are **account-linked** even though their
contents are minimized and encrypted. The minimization schemas are described in
[TUI capability coverage](tui-capabilities.md#diagnostic-upload-privacy). Both use
`/minimax-cloud/api/v1/observability/desktop-errors/batch` on the regional MiniMax host.
When the channel is disabled, TUI incidents are written as local-only files (7 days / 200
files) that are never uploaded, and LLM failure reports are dropped before buffering.

Either environment variable turns the channel off and takes precedence over the config file:

```sh
MCODE_DISABLE_TELEMETRY=1 mr
DO_NOT_TRACK=1 mr
```

## Locating the active config file

Builds from this repository use `~/.minimax/config.yaml` (or
`~/.minimax-<profile>/config.yaml` when a profile is selected) unless a data-directory
override is set; see [Accounts and data](installation.md#accounts-and-data).

Server-side retention for any channel is not defined or verified by this repository. Login,
model requests, update checks, and user-submitted feedback have separate network behavior
described in [TUI capability coverage](tui-capabilities.md).
