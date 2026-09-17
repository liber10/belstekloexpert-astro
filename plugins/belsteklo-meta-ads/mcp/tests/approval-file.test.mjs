import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { approvalFileInternals, loadDetachedApprovalFile } from '../src/approval-file.mjs';

const BUNDLE_REF = 'bundle_11111111-2222-4333-8444-555555555555';

async function fixture(t) {
  const approvalsPath = await fs.mkdtemp(path.join(os.tmpdir(), 'meta-bundle-approvals-'));
  t.after(async () => fs.rm(approvalsPath, { recursive: true, force: true }));
  return approvalsPath;
}

test('loads only the exact bundle approval filename', async (t) => {
  const approvalsPath = await fixture(t);
  const approval = { version: 1, marker: 'safe-fixture' };
  await fs.writeFile(path.join(approvalsPath, `${BUNDLE_REF}.approval.json`), JSON.stringify(approval), 'utf8');

  assert.deepEqual(await loadDetachedApprovalFile({ approvalsPath, bundleRef: BUNDLE_REF }), approval);
  await assert.rejects(
    () => loadDetachedApprovalFile({ approvalsPath, bundleRef: '../other' }),
    /missing or invalid/,
  );
});

test('rejects missing, malformed, and oversized approval files without returning their contents', async (t) => {
  const approvalsPath = await fixture(t);
  const target = path.join(approvalsPath, `${BUNDLE_REF}.approval.json`);

  await assert.rejects(() => loadDetachedApprovalFile({ approvalsPath, bundleRef: BUNDLE_REF }), /missing or invalid/);
  await fs.writeFile(target, '{not json', 'utf8');
  await assert.rejects(() => loadDetachedApprovalFile({ approvalsPath, bundleRef: BUNDLE_REF }), /missing or invalid/);
  await fs.writeFile(target, 'x'.repeat(approvalFileInternals.MAX_APPROVAL_BYTES + 1), 'utf8');
  await assert.rejects(() => loadDetachedApprovalFile({ approvalsPath, bundleRef: BUNDLE_REF }), /missing or invalid/);
});

test('rejects a symbolic-link approval when the platform permits creating it', async (t) => {
  const approvalsPath = await fixture(t);
  const actual = path.join(approvalsPath, 'actual.json');
  const linked = path.join(approvalsPath, `${BUNDLE_REF}.approval.json`);
  await fs.writeFile(actual, '{}', 'utf8');
  try {
    await fs.symlink(actual, linked, 'file');
  } catch (error) {
    if (['EPERM', 'EACCES', 'ENOSYS'].includes(error?.code)) return;
    throw error;
  }
  await assert.rejects(() => loadDetachedApprovalFile({ approvalsPath, bundleRef: BUNDLE_REF }), /missing or invalid/);
});
