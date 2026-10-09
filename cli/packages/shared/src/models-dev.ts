/**
 * Provenance marker recorded inside the bundled (and any already-persisted)
 * models.dev catalog snapshot.
 *
 * The distribution ships the snapshot as an asset and the CLI only ever reads
 * it; nothing in this fork fetches the registry. This constant survives because
 * snapshot bytes carry `source` and parsing must keep rejecting foreign files.
 */
export const MODELS_DEV_CATALOG_SOURCE_URL = 'https://models.dev/api.json';
