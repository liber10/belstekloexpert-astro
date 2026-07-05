#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultOutput = path.join(rootDir, 'src/data/glass-prices.json');
const defaultExcludedOutput = path.join(rootDir, '.private/glass-prices-excluded-review.json');

const aliases = {
  name: ['name', 'title', 'description', 'position', 'item', 'стекло', 'позиция', 'название', 'наименование', 'описание', 'модель'],
  eurocode: ['eurocode', 'euro code', 'code', 'sku', 'article', 'артикул', 'код', 'еврокод'],
  years: ['years', 'year', 'model years', 'period', 'годы', 'год', 'период'],
  priceUsd: ['glassPriceUsd', 'priceUsd', 'usd', 'price', 'cost', 'цена', 'цена usd', 'цена $', 'стоимость', 'стоимость usd'],
  excluded: ['excluded', 'exclude', 'private', 'review', 'status', 'hidden', 'исключить', 'исключено', 'не публиковать', 'скрыто', 'статус'],
};

const usage = `Usage:
  npm run prices:update -- --source <file.csv|file.tsv|file.json>

Options:
  --source <path>            Source price export.
  --output <path>            Public calculator JSON. Default: src/data/glass-prices.json
  --excluded-output <path>   Private excluded rows JSON. Default: .private/glass-prices-excluded-review.json
`;

const normalizeKey = (value) => String(value || '')
  .toLowerCase()
  .replace(/ё/g, 'е')
  .replace(/[^a-zа-я0-9]+/g, '');

const parseArgs = (argv) => {
  const args = {};

  for (let i = 0; i < argv.length; i += 1) {
    const current = argv[i];
    if (!current.startsWith('--')) continue;

    const key = current.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
    } else {
      args[key] = next;
      i += 1;
    }
  }

  return args;
};

const splitDelimitedLine = (line, delimiter) => {
  const cells = [];
  let cell = '';
  let quoted = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];

    if (char === '"' && quoted && next === '"') {
      cell += '"';
      i += 1;
      continue;
    }

    if (char === '"') {
      quoted = !quoted;
      continue;
    }

    if (char === delimiter && !quoted) {
      cells.push(cell.trim());
      cell = '';
      continue;
    }

    cell += char;
  }

  cells.push(cell.trim());
  return cells;
};

const parseDelimited = (content, delimiter) => {
  const lines = content
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter((line) => line.trim());

  if (!lines.length) return [];

  const headers = splitDelimitedLine(lines[0], delimiter);

  return lines.slice(1).map((line) => {
    const cells = splitDelimitedLine(line, delimiter);
    return Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? '']));
  });
};

const readRows = async (sourcePath) => {
  const ext = path.extname(sourcePath).toLowerCase();
  const content = await fs.readFile(sourcePath, 'utf8');

  if (ext === '.json') {
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed)) return parsed;
    if (Array.isArray(parsed.rows)) return parsed.rows;
    if (Array.isArray(parsed.items)) return parsed.items;
    if (Array.isArray(parsed.prices)) return parsed.prices;
    throw new Error('JSON must be an array or contain rows/items/prices array.');
  }

  if (ext === '.tsv') return parseDelimited(content, '\t');
  return parseDelimited(content, ',');
};

const getValue = (row, aliasList) => {
  const normalizedEntries = new Map(
    Object.entries(row).map(([key, value]) => [normalizeKey(key), value]),
  );

  for (const alias of aliasList) {
    const value = normalizedEntries.get(normalizeKey(alias));
    if (value !== undefined && value !== null && String(value).trim() !== '') return value;
  }

  return '';
};

const parsePrice = (value) => {
  if (typeof value === 'number') return value;

  const normalized = String(value || '')
    .replace(',', '.')
    .replace(/\s+/g, '')
    .replace(/[^0-9.-]/g, '');

  if (!normalized) return NaN;
  return Number(normalized);
};

const isExcluded = (row) => {
  const value = String(getValue(row, aliases.excluded) || '').toLowerCase();
  return /^(1|true|yes|y|да)$/i.test(value)
    || value.includes('exclude')
    || value.includes('private')
    || value.includes('review')
    || value.includes('hidden')
    || value.includes('исключ')
    || value.includes('скрыт')
    || value.includes('ревью')
    || value.includes('не публиковать');
};

const normalizeRow = (row, id) => {
  const name = String(getValue(row, aliases.name) || '').trim();
  const eurocode = String(getValue(row, aliases.eurocode) || '').trim();
  const years = String(getValue(row, aliases.years) || '').trim();
  const glassPriceUsd = parsePrice(getValue(row, aliases.priceUsd));

  return {
    id,
    name,
    eurocode,
    years,
    glassPriceUsd,
  };
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));

  if (!args.source || args.help) {
    console.log(usage);
    process.exitCode = args.help ? 0 : 1;
    return;
  }

  const sourcePath = path.resolve(String(args.source));
  const outputPath = path.resolve(String(args.output || defaultOutput));
  const excludedOutputPath = path.resolve(String(args['excluded-output'] || defaultExcludedOutput));

  const rows = await readRows(sourcePath);
  const publicRows = [];
  const excludedRows = [];
  const invalidRows = [];

  for (const row of rows) {
    if (isExcluded(row)) {
      excludedRows.push(row);
      continue;
    }

    const normalized = normalizeRow(row, publicRows.length + 1);
    if (!normalized.name || !Number.isFinite(normalized.glassPriceUsd) || normalized.glassPriceUsd <= 0) {
      invalidRows.push(row);
      continue;
    }

    publicRows.push(normalized);
  }

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(`${outputPath}.tmp`, `${JSON.stringify(publicRows, null, 2)}\n`, 'utf8');
  await fs.rename(`${outputPath}.tmp`, outputPath);

  if (excludedRows.length) {
    await fs.mkdir(path.dirname(excludedOutputPath), { recursive: true });
    await fs.writeFile(excludedOutputPath, `${JSON.stringify(excludedRows, null, 2)}\n`, 'utf8');
  }

  console.log(`Source rows: ${rows.length}`);
  console.log(`Published rows: ${publicRows.length}`);
  console.log(`Excluded rows: ${excludedRows.length}`);
  console.log(`Invalid rows skipped: ${invalidRows.length}`);
  console.log(`Updated: ${path.relative(rootDir, outputPath)}`);

  if (excludedRows.length) {
    console.log(`Excluded review file: ${path.relative(rootDir, excludedOutputPath)}`);
  }

  if (invalidRows.length) {
    console.log('Skipped rows had missing name or invalid glass price.');
  }
};

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
