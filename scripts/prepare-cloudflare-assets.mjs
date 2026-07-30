#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const assetsDirectory = resolve('dist/client');
const headersPath = resolve(assetsDirectory, '_headers');
const workersDevNoindexRule = `https://:version.:subdomain.workers.dev/*
  X-Robots-Tag: noindex, nofollow
`;

await mkdir(assetsDirectory, { recursive: true });

let existingHeaders = '';
try {
  existingHeaders = await readFile(headersPath, 'utf8');
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
}

const headers = [existingHeaders.trim(), workersDevNoindexRule.trim()]
  .filter(Boolean)
  .join('\n\n');

await writeFile(headersPath, `${headers}\n`, 'utf8');

console.log('Prepared Cloudflare static asset headers.');
