import test from 'node:test';
import assert from 'node:assert/strict';
import { graphVersion, normalizeAdAccountId, resolveAdAccountId } from '../src/config.mjs';

const withEnv = (values, callback) => {
  const previous = {};
  for (const [key, value] of Object.entries(values)) {
    previous[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return callback();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
};

test('normalizes and validates Graph version', () => {
  withEnv({ META_GRAPH_VERSION: '25.0' }, () => assert.equal(graphVersion(), 'v25.0'));
  withEnv({ META_GRAPH_VERSION: 'latest' }, () => assert.throws(() => graphVersion()));
});

test('normalizes account IDs and rejects non-digits', () => {
  assert.equal(normalizeAdAccountId('12345'), 'act_12345');
  assert.throws(() => normalizeAdAccountId('act_12x'));
});

test('enforces the account allowlist', () => {
  withEnv(
    { META_AD_ACCOUNT_ID: '12345', META_ALLOWED_AD_ACCOUNT_IDS: '12345,67890' },
    () => {
      assert.equal(resolveAdAccountId('67890'), 'act_67890');
      assert.throws(() => resolveAdAccountId('99999'));
    },
  );
});
