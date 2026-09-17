const ENTITY_TYPES = new Set(['campaign', 'adset', 'ad']);
const OPERATIONS = new Set(['pause', 'resume', 'set_daily_budget']);

export class PolicyError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PolicyError';
  }
}

function asMinorUnits(value, label) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new PolicyError(`${label} must be a positive integer.`);
  return parsed;
}

export function planChange({ entityType, operation, requestedBudgetMinor, current, policy }) {
  if (!ENTITY_TYPES.has(entityType)) throw new PolicyError('Unsupported entity type.');
  if (!OPERATIONS.has(operation)) throw new PolicyError('Unsupported operation.');

  if (operation === 'pause') {
    if (String(current.status).toUpperCase() === 'PAUSED') throw new PolicyError('Entity is already paused.');
    return { payload: { status: 'PAUSED' }, before: { status: current.status }, after: { status: 'PAUSED' }, risk: 'medium' };
  }

  if (operation === 'resume') {
    if (policy.writeMode === 'autopilot') throw new PolicyError('Autopilot may not resume delivery.');
    if (String(current.status).toUpperCase() === 'ACTIVE') throw new PolicyError('Entity is already active.');
    return { payload: { status: 'ACTIVE' }, before: { status: current.status }, after: { status: 'ACTIVE' }, risk: 'high' };
  }

  if (entityType === 'ad') throw new PolicyError('Daily budgets exist only on campaign or ad-set objects.');
  if (policy.maxDailyBudgetMinor === null) {
    throw new PolicyError('Budget changes are disabled until META_MAX_DAILY_BUDGET_MINOR is set.');
  }
  const currentBudget = asMinorUnits(current.daily_budget, 'Current daily budget');
  const nextBudget = asMinorUnits(requestedBudgetMinor, 'Requested daily budget');
  if (nextBudget > policy.maxDailyBudgetMinor) throw new PolicyError('Requested budget exceeds the absolute policy cap.');
  const changePct = (Math.abs(nextBudget - currentBudget) / currentBudget) * 100;
  if (changePct > policy.maxBudgetChangePct + Number.EPSILON) {
    throw new PolicyError('Requested budget change exceeds the percentage policy cap.');
  }
  if (policy.writeMode === 'autopilot' && nextBudget >= currentBudget) {
    throw new PolicyError('Autopilot may only reduce a budget.');
  }
  if (nextBudget === currentBudget) throw new PolicyError('Requested budget equals the current budget.');
  return {
    payload: { daily_budget: String(nextBudget) },
    before: { daily_budget_minor: currentBudget },
    after: { daily_budget_minor: nextBudget },
    change_pct: Number((((nextBudget - currentBudget) / currentBudget) * 100).toFixed(2)),
    risk: nextBudget > currentBudget ? 'high' : 'medium',
  };
}

export function assertFresh(change, current) {
  const before = change.before || {};
  if (before.status !== undefined && String(current.status) !== String(before.status)) {
    throw new PolicyError('Entity status changed after prepare; create a new change-set.');
  }
  if (
    before.daily_budget_minor !== undefined &&
    Number(current.daily_budget) !== Number(before.daily_budget_minor)
  ) {
    throw new PolicyError('Entity budget changed after prepare; create a new change-set.');
  }
  if (change.entityUpdatedTime && current.updated_time !== change.entityUpdatedTime) {
    throw new PolicyError('Entity was updated after prepare; create a new change-set.');
  }
}
