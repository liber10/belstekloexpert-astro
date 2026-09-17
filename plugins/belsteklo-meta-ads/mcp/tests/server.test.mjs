import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

test('MCP starts and exposes guarded read/write annotations', async (t) => {
  const testsDir = path.dirname(fileURLToPath(import.meta.url));
  const pluginRoot = path.resolve(testsDir, '..', '..');
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-bundle-server-'));
  t.after(() => fs.rmSync(stateDir, { recursive: true, force: true }));
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(pluginRoot, 'mcp', 'server.mjs')],
    cwd: pluginRoot,
    env: { META_WRITE_MODE: 'off', META_BUNDLE_STATE_DIR: stateDir },
    stderr: 'pipe',
  });
  const client = new Client({ name: 'belsteklo-meta-ads-test', version: '0.1.0' });
  try {
    await client.connect(transport);
    const result = await client.listTools();
    const tools = new Map(result.tools.map((tool) => [tool.name, tool]));
    assert.deepEqual([...tools.keys()].sort(), [
      'meta_apply_change',
      'meta_connection_status',
      'meta_get_account_activities',
      'meta_get_ad_account',
      'meta_get_campaign_bundle',
      'meta_get_guardrails',
      'meta_get_insights',
      'meta_list_ad_accounts',
      'meta_list_ad_creatives',
      'meta_list_ads',
      'meta_list_adsets',
      'meta_list_campaign_bundles',
      'meta_list_campaigns',
      'meta_list_local_changes',
      'meta_materialize_campaign_bundle',
      'meta_prepare_campaign_bundle',
      'meta_prepare_change',
      'meta_reconcile_campaign_bundle',
      'meta_validate_write_access',
    ]);
    const validationTool = tools.get('meta_validate_write_access');
    assert.equal(validationTool.annotations.readOnlyHint, true);
    assert.equal(validationTool.annotations.destructiveHint, false);
    assert.equal(validationTool.annotations.idempotentHint, true);
    assert.deepEqual(validationTool.inputSchema.properties, {});
    assert.equal(JSON.stringify(validationTool.inputSchema).includes('token'), false);
    assert.equal(JSON.stringify(validationTool.inputSchema).includes('account_id'), false);
    assert.equal(tools.get('meta_list_campaigns').annotations.readOnlyHint, true);
    assert.equal(tools.get('meta_apply_change').annotations.readOnlyHint, false);
    assert.equal(tools.get('meta_apply_change').annotations.destructiveHint, true);
    const prepareBundle = tools.get('meta_prepare_campaign_bundle');
    const materializeBundle = tools.get('meta_materialize_campaign_bundle');
    const reconcileBundle = tools.get('meta_reconcile_campaign_bundle');
    assert.equal(prepareBundle.annotations.readOnlyHint, false);
    assert.equal(prepareBundle.annotations.destructiveHint, false);
    assert.equal(materializeBundle.annotations.readOnlyHint, false);
    assert.equal(materializeBundle.annotations.destructiveHint, true);
    assert.equal(reconcileBundle.annotations.destructiveHint, false);
    assert.equal(reconcileBundle.annotations.idempotentHint, true);
    assert.equal(tools.get('meta_get_campaign_bundle').annotations.readOnlyHint, true);
    assert.equal(tools.get('meta_list_campaign_bundles').annotations.readOnlyHint, true);
    assert.equal(tools.get('meta_get_campaign_bundle').inputSchema.additionalProperties, false);
    assert.equal(tools.get('meta_list_campaign_bundles').inputSchema.additionalProperties, false);
    assert.equal(prepareBundle.inputSchema.additionalProperties, false);
    assert.equal(prepareBundle.inputSchema.properties.spec.additionalProperties, false);
    assert.equal(prepareBundle.inputSchema.properties.spec.properties.ads.items.additionalProperties, false);
    const materializeSchema = JSON.stringify(materializeBundle.inputSchema);
    assert.equal(materializeSchema.includes('access_token'), false);
    assert.equal(materializeSchema.includes('provider_id'), false);
    assert.equal(materializeSchema.includes('status'), false);
    assert.equal(materializeSchema.includes('signature'), false);
    assert.equal(tools.has('meta_publish_campaign_bundle'), false);
    assert.equal(tools.has('meta_delete_campaign_bundle'), false);

    const malformedRef = 'bundle_11111111-2222-4333-8444-555555555555';
    const sentinelRawId = '999999999999999';
    fs.mkdirSync(path.join(stateDir, 'bundles'), { recursive: true });
    fs.writeFileSync(
      path.join(stateDir, 'bundles', `${malformedRef}.json`),
      JSON.stringify({
        bundle_ref: malformedRef,
        account_scope: 'account_scope_malformed',
        intent_hash: `sha256:${'a'.repeat(64)}`,
        idempotency_digest: 'b'.repeat(64),
        idempotency_intent_digest: 'c'.repeat(64),
        revision: 1,
        state: 'prepared',
        created_at: '2026-08-15T12:00:00.000Z',
        updated_at: '2026-08-15T12:00:00.000Z',
        raw_provider_id: sentinelRawId,
      }),
      'utf8',
    );
    const malformedResult = await client.callTool({
      name: 'meta_get_campaign_bundle',
      arguments: { bundle_ref: malformedRef },
    });
    assert.equal(malformedResult.isError, true);
    assert.equal(JSON.stringify(malformedResult).includes(sentinelRawId), false);
    assert.match(JSON.stringify(malformedResult), /malformed/);
  } finally {
    await client.close();
  }
});
