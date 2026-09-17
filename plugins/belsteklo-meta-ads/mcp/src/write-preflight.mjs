export async function runGuardedWritePreflight({
  checkApproval,
  validateWriteAccess,
  assertCooldown,
  readCurrent,
  assertFresh,
  validatePlan,
}) {
  // Reject obviously invalid requests before making capability probes. The same
  // approval is checked again afterwards so network latency cannot bypass TTL.
  checkApproval();
  const writeAccess = await validateWriteAccess();
  if (!writeAccess.ready_for_guarded_write) {
    throw new Error('Write access validation failed. No Meta mutation was attempted.');
  }

  const change = checkApproval();
  assertCooldown(change);
  const current = await readCurrent(change);
  assertFresh(change, current);
  validatePlan(change, current);
  return { change, current, writeAccess };
}
