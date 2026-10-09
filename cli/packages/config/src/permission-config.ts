/**
 * Permission runtime knobs. Extracted from `config.ts` to keep the main
 * schema file under the 2_000-line guard.
 *
 * The former `classifierTimeoutMs` knob is gone with the cloud classifier:
 * this fork settles permission decisions entirely with local rules.
 */

export type PermissionPolicyOwner = 'engine' | 'core';
export type PermissionStorageWriteVersion = 1 | 2;

export interface PermissionConfig {
  /**
   * Final deterministic policy owner. Core is the default; Engine remains an
   * explicit rollback path.
   */
  policyOwner: PermissionPolicyOwner;

  /**
   * Disk format used for new or explicitly modified permission.json files.
   * Readers always accept both versions; v2 is the product default and an
   * explicit v1 value is the storage rollback switch.
   */
  storageWriteVersion: PermissionStorageWriteVersion;

  /**
   * Whether permission checks may create user-confirmation requests.
   * Standard builds default to true. Headless builds may default this to
   * false so an ASK decision fails closed instead of waiting forever.
   */
  userConfirmationEnabled: boolean;
}

export const PERMISSION_CONFIG_DEFAULTS: PermissionConfig = {
  policyOwner: 'core',
  storageWriteVersion: 2,
  userConfirmationEnabled: true,
};

/**
 * Parse the `permission:` block from raw config.
 */
export function parsePermissionConfig(
  raw: Record<string, unknown>,
  defaults: PermissionConfig = PERMISSION_CONFIG_DEFAULTS,
): PermissionConfig {
  const perm = raw.permission;
  if (perm == null || typeof perm !== 'object' || Array.isArray(perm)) {
    return { ...defaults };
  }
  const obj = perm as Record<string, unknown>;
  const policyOwner =
    obj.policyOwner === undefined
      ? defaults.policyOwner
      : obj.policyOwner === 'engine' || obj.policyOwner === 'core'
        ? obj.policyOwner
        : 'engine';
  const storageWriteVersion =
    obj.storageWriteVersion === 1 || obj.storageWriteVersion === 2
      ? obj.storageWriteVersion
      : defaults.storageWriteVersion;
  const userConfirmationEnabled =
    typeof obj.userConfirmationEnabled === 'boolean'
      ? obj.userConfirmationEnabled
      : defaults.userConfirmationEnabled;
  return { policyOwner, storageWriteVersion, userConfirmationEnabled };
}
