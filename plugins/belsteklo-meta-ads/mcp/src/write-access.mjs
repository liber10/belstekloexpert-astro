const REQUIRED_PERMISSIONS = ['ads_management', 'ads_read'];
const FORBIDDEN_PERMISSIONS = ['business_management'];
const APPROVED_PERMISSIONS = new Set([...REQUIRED_PERMISSIONS, 'public_profile']);

export function evaluateWriteAccess({
  permissions = [],
  permissionEndpointAvailable = true,
  appSecretProofEnabled = false,
  visibleAccountCount = 0,
  configuredAccountCount = 0,
} = {}) {
  const granted = new Set(
    permissions
      .filter(({ status }) => status === 'granted')
      .map(({ permission }) => permission),
  );
  const permissionState = (permission) =>
    granted.has(permission) ? 'granted' : permissionEndpointAvailable ? 'missing' : 'unconfirmed';
  const requiredPermissions = Object.fromEntries(
    REQUIRED_PERMISSIONS.map((permission) => [permission, permissionState(permission)]),
  );
  const forbiddenPermissions = Object.fromEntries(
    FORBIDDEN_PERMISSIONS.map((permission) => [
      permission,
      granted.has(permission) ? 'granted' : permissionEndpointAvailable ? 'not_granted' : 'unconfirmed',
    ]),
  );
  const unexpectedGrantedPermissions = [...granted]
    .filter((permission) => !APPROVED_PERMISSIONS.has(permission))
    .sort();
  const leastPrivilegeConfirmed =
    permissionEndpointAvailable &&
    REQUIRED_PERMISSIONS.every((permission) => requiredPermissions[permission] === 'granted') &&
    FORBIDDEN_PERMISSIONS.every((permission) => forbiddenPermissions[permission] === 'not_granted') &&
    unexpectedGrantedPermissions.length === 0;
  const allConfiguredAccountsVisible =
    configuredAccountCount > 0 && visibleAccountCount === configuredAccountCount;
  const readyForGuardedWrite =
    Boolean(appSecretProofEnabled) && leastPrivilegeConfirmed && allConfiguredAccountsVisible;
  const warnings = [];

  if (!permissionEndpointAvailable) {
    warnings.push('The system-user token did not expose /me/permissions; exact scopes remain unconfirmed.');
  }
  if (visibleAccountCount === 0) {
    warnings.push('The write token cannot see any locally allow-listed ad account.');
  } else if (!allConfiguredAccountsVisible) {
    warnings.push('The write token cannot see every locally allow-listed ad account.');
  }
  if (forbiddenPermissions.business_management === 'granted') {
    warnings.push('business_management is granted but is not allowed for this runtime identity.');
  }
  if (unexpectedGrantedPermissions.length > 0) {
    warnings.push('The write token has permissions outside the approved ads-only set.');
  }
  if (!appSecretProofEnabled) {
    warnings.push('META_APP_SECRET is not configured; appsecret_proof is disabled.');
  }

  return {
    ok: readyForGuardedWrite,
    account_probe_succeeded: visibleAccountCount > 0,
    all_configured_accounts_visible: allConfiguredAccountsVisible,
    required_permissions: requiredPermissions,
    forbidden_permissions: forbiddenPermissions,
    unexpected_granted_permissions: unexpectedGrantedPermissions,
    least_privilege_confirmed: leastPrivilegeConfirmed,
    ready_for_guarded_write: readyForGuardedWrite,
    warnings,
  };
}
