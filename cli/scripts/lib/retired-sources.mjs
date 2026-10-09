// Retired host implementation, declared once and enforced by two different checks.
//
// The two checks have different domains and must not be collapsed into one list:
// `check:source` inspects the files that exist in this repository, while
// `check:standalone` inspects the input graph of the produced bundle. A path
// therefore belongs to exactly one of the two sets below.

// Must not exist as public source at all. Enforced by `check:source`.
export const retiredSourceRoots = [
  "packages/agent-modules/team/",
  "packages/agent-modules/permission/src/confirmation-gateway-client.ts",
  "packages/tui/src/auth/identity.ts",
  "packages/local-runtime/src/messages/queue-serialization.ts",
  "packages/local-runtime/src/workspace-indexing/",
  "packages/local-runtime-v2/src/service/workspace/indexing.ts",
  "packages/local-runtime-v2/src/application/conversation/workspace-snapshot-gate.ts",
  "packages/agent-tools/src/desktop/local-workspace-semantic-search.ts",
  "packages/thrift-gen/",
  "packages/thrift-gen-client/",
  "packages/local-runtime/src/http/",
  "packages/local-runtime-v2/src/http/",
  "packages/protocol/src/generated/",
  "packages/local-runtime-v2/src/service/session-handoff/",
  // The BYOK-only distribution ships the models.dev snapshot as a bundled asset
  // and must never fetch it, so the registry pull path stays out of this fork.
  "packages/local-runtime-v2/src/service/model-system/catalog/provider-presets/provider-presets.client.ts",
  // Users of this fork report problems to their own vendor, not to MiniMax: the
  // `/feedback` command, its reviewed draft, archive projection and ticket client
  // are deleted rather than gated off, so the upload code cannot come back.
  "packages/tui/src/runtime/feedback/",
  "packages/tui/src/tui/features/feedback/",
  "packages/tui/src/tui/controller/product/feedback-flow.ts",
  // Nothing reports errors to MiniMax either: the automatic desktop-error batch
  // client, the TUI incident queue that drained into it, and the opt-in channel
  // that authorized both are deleted, so no future config key can re-enable a send.
  "packages/local-runtime/src/error-reporting/",
  "packages/tui/src/observability/incident-reporter.ts",
  "packages/config/src/telemetry-policy.ts",
  // Permission decisions stay on the machine: the cloud classifier client, its
  // gateway contract, the HTTP transport, the test double and the conversation
  // renderer that fed its payload are deleted. `auto` mode keeps its name but
  // asks whenever local rules cannot settle the decision.
  "packages/agent-modules/permission/src/classifier/cloud-classify-client.ts",
  "packages/agent-modules/permission/src/cloud-gateway.ts",
  "packages/agent-modules/permission/src/http-cloud-gateway-client.ts",
  "packages/agent-modules/permission/src/in-memory-cloud-gateway-client.ts",
  "packages/agent-modules/permission/src/conversation-renderer.ts",
];

// May exist as public source, but must never be reachable from the standalone
// build. Enforced by `check:standalone`.
export const nonBundledSources = [
  "packages/local-runtime/src/services/cu/native.ts",
];

// Anything retired from the source tree must also stay out of the build graph, so
// the boundary check enforces both sets. Declaring the union here keeps a path
// that later becomes publishable from silently losing its bundle restriction.
export const retiredBuildInputs = [
  ...retiredSourceRoots,
  ...nonBundledSources,
];
