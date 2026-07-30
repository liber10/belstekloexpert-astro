#!/usr/bin/env node

const args = new Set(process.argv.slice(2));
const baseUrlValue = readArgument('--base-url');
const expectNoindex = args.has('--expect-noindex');
const expectIndexable = args.has('--expect-indexable');

if (!baseUrlValue || expectNoindex === expectIndexable) {
  console.error(
    'Usage: node scripts/check-edge-readiness.mjs --base-url <url> ' +
      '(--expect-noindex | --expect-indexable)',
  );
  process.exit(2);
}

const baseUrl = new URL(baseUrlValue);
const failures = [];

await checkHomepage();
await checkContentPage();
await checkHealth();
await checkLeadEndpoint();

if (failures.length > 0) {
  console.error('\nRead-only edge check failed:');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log(`\nRead-only edge check passed for ${baseUrl.origin}`);

function readArgument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function checkHomepage() {
  const response = await request(baseUrl);
  assert(response.status === 200, `homepage returned HTTP ${response.status}`);
  checkRobotsPolicy(response, 'homepage');
  printResult('homepage', response.status);
}

async function checkContentPage() {
  const response = await request(new URL('/remont-skolov/', baseUrl));
  assert(response.status === 200, `content page returned HTTP ${response.status}`);
  checkRobotsPolicy(response, 'content page');
  printResult('content page', response.status);
}

function checkRobotsPolicy(response, label) {
  const robotsHeader = response.headers.get('x-robots-tag')?.toLowerCase() ?? '';
  if (expectNoindex) {
    assert(robotsHeader.includes('noindex'), `preview ${label} is missing X-Robots-Tag: noindex`);
  } else {
    assert(!robotsHeader.includes('noindex'), `production ${label} unexpectedly contains noindex`);
  }
}

async function checkHealth() {
  const healthUrl = new URL('/api/health/', baseUrl);
  let lastResponse;
  let health;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    lastResponse = await request(healthUrl);
    health = await readJson(lastResponse);

    if (
      lastResponse.status === 200 &&
      health?.status === 'ok' &&
      health?.database === 'connected'
    ) {
      printResult('health', lastResponse.status);
      return;
    }

    if (attempt < 2) {
      await new Promise((resolve) => setTimeout(resolve, 1_500));
    }
  }

  assert(false, `health remained unavailable (HTTP ${lastResponse?.status ?? 'unknown'})`);
}

async function checkLeadEndpoint() {
  const response = await request(new URL('/api/lead/', baseUrl));
  const body = await readJson(response);

  assert(response.status === 405, `GET /api/lead/ returned HTTP ${response.status}, expected 405`);
  assert(body?.pipeline === 'hub', 'GET /api/lead/ did not report the hub pipeline');
  printResult('lead endpoint', response.status);
}

async function request(url) {
  try {
    return await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(30_000),
      headers: {
        'user-agent': 'BelStekloExpert-read-only-check/1.0',
      },
    });
  } catch {
    console.error(`Request failed for ${url.origin}${url.pathname}`);
    process.exit(1);
  }
}

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

function assert(condition, message) {
  if (!condition) failures.push(message);
}

function printResult(name, status) {
  console.log(`PASS ${name}: HTTP ${status}`);
}
