import fs from 'node:fs/promises';
import path from 'node:path';

const BUNDLE_REF_PATTERN = /^bundle_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MAX_APPROVAL_BYTES = 64 * 1024;

export async function loadDetachedApprovalFile({ approvalsPath, bundleRef }) {
  if (typeof approvalsPath !== 'string' || !path.isAbsolute(approvalsPath)) {
    throw new Error('Detached approval file is missing or invalid.');
  }
  if (!BUNDLE_REF_PATTERN.test(String(bundleRef || ''))) {
    throw new Error('Detached approval file is missing or invalid.');
  }

  let handle;
  try {
    const approvalDirectory = await fs.realpath(approvalsPath);
    const candidate = path.join(approvalDirectory, `${bundleRef}.approval.json`);
    const sourceStat = await fs.lstat(candidate);
    if (!sourceStat.isFile() || sourceStat.isSymbolicLink() || sourceStat.size > MAX_APPROVAL_BYTES) {
      throw new Error('invalid approval file');
    }

    const resolvedCandidate = await fs.realpath(candidate);
    const relative = path.relative(approvalDirectory, resolvedCandidate);
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('approval path escaped its directory');

    handle = await fs.open(resolvedCandidate, 'r');
    const openedStat = await handle.stat();
    if (!openedStat.isFile() || openedStat.size > MAX_APPROVAL_BYTES) throw new Error('invalid opened approval file');
    const contents = await handle.readFile('utf8');
    if (Buffer.byteLength(contents, 'utf8') > MAX_APPROVAL_BYTES) {
      throw new Error('approval content exceeds its size limit');
    }

    const postOpenStat = await fs.lstat(candidate);
    if (
      postOpenStat.isSymbolicLink() ||
      String(postOpenStat.dev) !== String(sourceStat.dev) ||
      String(postOpenStat.ino) !== String(sourceStat.ino)
    ) {
      throw new Error('approval file changed while it was read');
    }
    return JSON.parse(contents);
  } catch {
    throw new Error('Detached approval file is missing or invalid.');
  } finally {
    if (handle) await handle.close().catch(() => {});
  }
}

export const approvalFileInternals = Object.freeze({ BUNDLE_REF_PATTERN, MAX_APPROVAL_BYTES });
