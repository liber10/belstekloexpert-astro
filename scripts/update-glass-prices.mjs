#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultOutput = path.join(rootDir, 'src/data/glass-prices.json');
const defaultExcludedOutput = path.join(rootDir, '.private/glass-prices-excluded-review.json');
const xlsxReader = path.join(rootDir, 'scripts/read-xlsx.ps1');

const DEFAULT_USD_TO_BYN_RATE = 3;
const SERVICE_COMPONENT_ENV = 'GLASS_SERVICE_COMPONENT_BYN';
const RATE_ENV = 'GLASS_PRICE_USD_TO_BYN';
const CURRENT_YEAR = 2026;

const aliases = {
  name: ['name', 'title', 'description', 'position', 'item', 'стекло', 'позиция', 'название', 'наименование', 'описание', 'модель'],
  eurocode: ['eurocode', 'euro code', 'code', 'sku', 'article', 'артикул', 'код', 'еврокод'],
  years: ['years', 'year', 'model years', 'period', 'годы', 'год', 'годы выпуска', 'период'],
  priceUsd: ['glassPriceUsd', 'priceUsd', 'usd', 'price', 'cost', 'цена', 'цена usd', 'цена $', 'стоимость', 'стоимость usd'],
  stock: ['stock', 'qty', 'quantity', 'остаток', 'наличие'],
  excluded: ['excluded', 'exclude', 'private', 'review', 'status', 'hidden', 'исключить', 'исключено', 'не публиковать', 'скрыто', 'статус'],
};

const brandDefinitions = [
  ['ALFA ROMEO', 'Alfa Romeo', ['alfa romeo', 'альфа ромео']],
  ['ASTON MARTIN', 'Aston Martin', ['aston martin', 'астон мартин']],
  ['LAND ROVER', 'Land Rover', ['land rover', 'ленд ровер']],
  ['RANGE ROVER', 'Range Rover', ['range rover', 'рейндж ровер']],
  ['GREAT WALL', 'Great Wall', ['great wall', 'грейт волл']],
  ['MERCEDES', 'Mercedes-Benz', ['mercedes-benz', 'mercedes benz', 'mercedes', 'мерседес', 'мерседес бенц']],
  ['VOLKSWAGEN', 'Volkswagen', ['volkswagen', 'vw', 'фольксваген', 'фольцваген', 'фольц']],
  ['CHEVROLET', 'Chevrolet', ['chevrolet', 'шевроле']],
  ['CHRYSLER', 'Chrysler', ['chrysler', 'крайслер']],
  ['CITROEN', 'Citroen', ['citroen', 'ситроен']],
  ['HYUNDAI', 'Hyundai', ['hyundai', 'хендай', 'хундай']],
  ['MITSUBISHI', 'Mitsubishi', ['mitsubishi', 'митсубиси', 'мицубиси']],
  ['NISSAN', 'Nissan', ['nissan', 'ниссан']],
  ['PEUGEOT', 'Peugeot', ['peugeot', 'пежо']],
  ['RENAULT', 'Renault', ['renault', 'рено']],
  ['TOYOTA', 'Toyota', ['toyota', 'тойота']],
  ['VOLVO', 'Volvo', ['volvo', 'вольво']],
  ['SKODA', 'Skoda', ['skoda', 'шкода']],
  ['SUBARU', 'Subaru', ['subaru', 'субару']],
  ['SUZUKI', 'Suzuki', ['suzuki', 'сузуки']],
  ['TESLA', 'Tesla', ['tesla', 'тесла']],
  ['AUDI', 'Audi', ['audi', 'ауди']],
  ['BMW', 'BMW', ['bmw', 'бмв']],
  ['BYD', 'BYD', ['byd', 'би вай ди']],
  ['CHERY', 'Chery', ['chery', 'чери']],
  ['DACIA', 'Dacia', ['dacia', 'дачия']],
  ['DAEWOO', 'Daewoo', ['daewoo', 'дэу']],
  ['DAF', 'DAF', ['daf', 'даф']],
  ['DODGE', 'Dodge', ['dodge', 'додж']],
  ['FIAT', 'Fiat', ['fiat', 'фиат']],
  ['FORD', 'Ford', ['ford', 'форд']],
  ['GAZ', 'GAZ', ['gaz', 'газ']],
  ['GEELY', 'Geely', ['geely', 'джили']],
  ['HONDA', 'Honda', ['honda', 'хонда']],
  ['IVECO', 'Iveco', ['iveco', 'ивеко']],
  ['JAC', 'JAC', ['jac', 'джак']],
  ['JAGUAR', 'Jaguar', ['jaguar', 'ягуар']],
  ['JEEP', 'Jeep', ['jeep', 'джип']],
  ['KIA', 'Kia', ['kia', 'киа']],
  ['LADA', 'Lada', ['lada', 'лада', 'ваз', 'vaz']],
  ['LEXUS', 'Lexus', ['lexus', 'лексус']],
  ['MAN', 'MAN', ['man', 'ман']],
  ['MAZDA', 'Mazda', ['mazda', 'мазда']],
  ['MINI', 'Mini', ['mini', 'мини']],
  ['OPEL', 'Opel', ['opel', 'опель']],
  ['PORSCHE', 'Porsche', ['porsche', 'порше']],
  ['SAAB', 'Saab', ['saab', 'сааб']],
  ['SCANIA', 'Scania', ['scania', 'скания']],
  ['SEAT', 'Seat', ['seat', 'сеат']],
  ['UAZ', 'UAZ', ['uaz', 'уаз']],
  ['VOYAH', 'Voyah', ['voyah', 'воях']],
  ['ZEEKR', 'Zeekr', ['zeekr', 'зикр']],
].map(([key, label, searchAliases]) => ({
  key,
  label,
  aliases: [key, label, ...searchAliases],
}));

const descriptorTokens = new Set([
  '2D', '3D', '4D', '5D', '2LIM', '3LIM', '4LIM', '5KOM',
  'HBK', 'HATCHBACK', 'SED', 'SEDAN', 'STW', 'WAGON', 'ESTATE',
  'SUV', 'VAN', 'TRUCK', 'PICKUP', 'MPV', 'CPE', 'COUPE', 'CABRIOLET',
  'FBK', 'FASTBACK', 'SPORTBACK', 'ROADSTER', 'WORKER', 'BUS',
]);

const glassTypeLabels = {
  windshield: 'Лобовое стекло',
  side: 'Боковое стекло',
  rear: 'Заднее стекло',
  other: 'Другое стекло',
};

const usage = `Usage:
  npm run prices:update -- --source <file.xlsx|file.csv|file.tsv|file.json>

Options:
  --source <path>            Source price export.
  --output <path>            Public calculator JSON. Default: src/data/glass-prices.json
  --excluded-output <path>   Private excluded rows JSON. Default: .private/glass-prices-excluded-review.json

Calculator constants:
  ${SERVICE_COMPONENT_ENV}    Private internal component added to the public total.
  ${RATE_ENV}         USD to Belarusian ruble rate. Default: ${DEFAULT_USD_TO_BYN_RATE}.
`;

const normalizeKey = (value) => String(value || '')
  .toLowerCase()
  .replace(/ё/g, 'е')
  .replace(/[^a-zа-я0-9]+/g, '');

const normalizeSearch = (value) => String(value || '')
  .toLowerCase()
  .replace(/ё/g, 'е')
  .replace(/[^a-zа-я0-9]+/gi, ' ')
  .trim()
  .replace(/\s+/g, ' ');

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

const loadLocalEnv = async () => {
  const envPath = path.join(rootDir, '.env');

  try {
    const content = await fs.readFile(envPath, 'utf8');

    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();

      if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;

      const [rawKey, ...valueParts] = trimmed.split('=');
      const key = rawKey.trim();
      const value = valueParts.join('=').trim().replace(/^['"]|['"]$/g, '');

      if (key && process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
};

const parsePricingNumber = (name, fallback) => {
  const rawValue = process.env[name];

  if (rawValue === undefined || rawValue === '') {
    if (fallback !== undefined) return fallback;
    throw new Error(`Set ${name} in .env before running price update.`);
  }

  const value = Number(String(rawValue).replace(',', '.'));

  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a non-negative number.`);
  }

  return value;
};

const resolvePricingConfig = () => ({
  exchangeRate: parsePricingNumber(RATE_ENV, DEFAULT_USD_TO_BYN_RATE),
  serviceComponentByn: parsePricingNumber(SERVICE_COMPONENT_ENV),
});

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

const readXlsxRows = async (sourcePath) => {
  const powershell = process.platform === 'win32' ? 'powershell.exe' : 'pwsh';
  const result = spawnSync(
    powershell,
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', xlsxReader, '-Path', sourcePath],
    { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 },
  );

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(result.stderr || `XLSX reader exited with code ${result.status}`);
  }

  return JSON.parse(result.stdout || '[]');
};

const readRows = async (sourcePath) => {
  const ext = path.extname(sourcePath).toLowerCase();

  if (ext === '.xlsx') return readXlsxRows(sourcePath);

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

const parseYearBounds = (yearText) => {
  const value = String(yearText || '');
  const rangeMatch = value.match(/((?:19|20)\d{2})\s*[-–.]+\s*(Q|(?:19|20)\d{2}|\d{2})/i);

  if (rangeMatch) {
    const start = Number(rangeMatch[1]);
    let end;

    if (/^q$/i.test(rangeMatch[2])) {
      end = 9999;
    } else if (/^\d{2}$/.test(rangeMatch[2])) {
      const century = Math.floor(start / 100) * 100;
      end = century + Number(rangeMatch[2]);
      if (end < start) end += 100;
    } else {
      end = Number(rangeMatch[2]);
    }

    return [start, end];
  }

  const openEndedMatch = value.match(/((?:19|20)\d{2})\s*[-–.]+\s*$/);
  if (openEndedMatch) return [Number(openEndedMatch[1]), 9999];

  const years = value.match(/(?:19|20)\d{2}/g)?.map(Number) || [];
  if (years.length >= 2) return [Math.min(...years), Math.max(...years)];
  if (years.length === 1) return [years[0], /[-–]\s*Q/i.test(value) ? 9999 : years[0]];
  return [null, null];
};

const yearOptionsFromBounds = (fromYear, toYear) => {
  if (!fromYear || !toYear) return [];

  const cappedEnd = Math.min(toYear, CURRENT_YEAR);
  if (cappedEnd < fromYear) return [];

  return Array.from({ length: cappedEnd - fromYear + 1 }, (_, index) => fromYear + index);
};

const isExplicitlyExcluded = (row) => {
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

const getReviewReason = ({ name, eurocode, glassType, glassPriceUsd }) => {
  const haystack = `${name} ${eurocode}`.toLowerCase();
  if (haystack.includes('defect')
    || haystack.includes('дефект')
    || haystack.includes('брак')
    || haystack.includes('потерт')
    || haystack.includes('царап')) {
    return 'defect-or-damaged';
  }

  const startsAsAccessory = /^(молдинг|профил|profil|лезви|основа|уплотнитель|универсальный)\b/i.test(String(name || ''));
  const hasAccessoryWord = /\b(молдинг|профиль|профил|уплотнитель|скотч|лезви|клипс|датчик дождя|праймер|герметик|струна|нож|стамеск)\b/i.test(haystack);

  if (startsAsAccessory || (hasAccessoryWord && glassPriceUsd < 25)) {
    return 'accessory-or-consumable';
  }

  if (glassType === 'other') {
    return 'unknown-glass-type';
  }

  if (glassType === 'windshield' && glassPriceUsd < 20) {
    return 'low-windshield-price';
  }

  return '';
};

const detectGlassType = ({ name, eurocode }) => {
  const upperCode = String(eurocode || '').toUpperCase();
  const lowerName = String(name || '').toLowerCase();
  const codeMarker = upperCode.match(/(?:^|\/)(?:FW)?\d+([A-Z])/i)?.[1] || '';

  if (
    codeMarker === 'L'
    || codeMarker === 'R'
    || /левое|правое|опускн|неподв|форточ|перед\.|зад\./i.test(lowerName)
  ) {
    return 'side';
  }

  if (codeMarker === 'B' || /заднее|заднее стекло/i.test(lowerName)) {
    return 'rear';
  }

  if (codeMarker === 'A' || /лобовое|ветровое|windshield/i.test(lowerName)) {
    return 'windshield';
  }

  return 'other';
};

const detectBrand = (name) => {
  const normalizedName = normalizeSearch(name);

  for (const definition of brandDefinitions) {
    const matchedAlias = definition.aliases
      .map((alias) => normalizeSearch(alias))
      .filter(Boolean)
      .sort((a, b) => b.length - a.length)
      .find((alias) => normalizedName === alias || normalizedName.startsWith(`${alias} `));

    if (matchedAlias) {
      return {
        key: definition.key,
        label: definition.label,
        aliases: definition.aliases,
        matchedAlias,
      };
    }
  }

  const fallback = String(name || '').trim().split(/\s+/)[0] || 'UNKNOWN';
  return {
    key: fallback.toUpperCase(),
    label: fallback,
    aliases: [fallback],
    matchedAlias: normalizeSearch(fallback),
  };
};

const titleCaseModel = (model) => {
  if (!model) return '';
  if (/\d/.test(model)) return model.toUpperCase();
  return model
    .split(/([\s/-]+)/)
    .map((part) => (/^[a-zа-я]+$/i.test(part) ? part.charAt(0).toUpperCase() + part.slice(1).toLowerCase() : part))
    .join('');
};

const extractModel = (name, brand) => {
  let tail = String(name || '').trim();
  const normalizedTail = normalizeSearch(tail);

  const matched = brand.aliases
    .map((alias) => normalizeSearch(alias))
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
    .find((alias) => normalizedTail === alias || normalizedTail.startsWith(`${alias} `));

  if (matched) {
    tail = tail.replace(new RegExp(`^\\s*${matched.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i'), '').trim();
  }

  tail = tail
    .split(/(?:19|20)\d{2}/)[0]
    .split('(')[0]
    .replace(/[|#].*$/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  const firstVariant = tail.split(/\s+\/\s*|\/+/)[0].trim();
  const tokens = firstVariant
    .split(/[\s,]+/)
    .map((token) => token.replace(/^[^\wа-я]+|[^\wа-я-]+$/gi, ''))
    .filter(Boolean)
    .filter((token) => !descriptorTokens.has(token.toUpperCase()));

  if (!tokens.length) return brand.label;

  const first = tokens[0];
  const second = tokens[1] || '';

  if (/^LAND$/i.test(first) && /^CRUISER$/i.test(second)) return 'Land Cruiser';
  if (/^LANDCRUISER$/i.test(first) && /^PRADO$/i.test(second)) return 'Land Cruiser Prado';
  if (/^C$/i.test(first) && /^MAX$/i.test(second)) return 'C-Max';
  if (/^S$/i.test(first) && /^MAX$/i.test(second)) return 'S-Max';

  return titleCaseModel(first);
};

const normalizeRow = (row, id, pricing) => {
  const name = String(getValue(row, aliases.name) || '').trim().replace(/\s+/g, ' ');
  const eurocode = String(getValue(row, aliases.eurocode) || '').trim();
  const years = String(getValue(row, aliases.years) || '').trim();
  const stock = String(getValue(row, aliases.stock) || '').trim();
  const glassPriceUsd = parsePrice(getValue(row, aliases.priceUsd));
  const [fromYear, toYear] = parseYearBounds(years);
  const brand = detectBrand(name);
  const model = extractModel(name, brand);
  const glassType = detectGlassType({ name, eurocode });
  const totalPriceByn = Math.round((glassPriceUsd * pricing.exchangeRate) + pricing.serviceComponentByn);

  return {
    id,
    brand: brand.label,
    brandKey: brand.key,
    brandAliases: [...new Set(brand.aliases.map(normalizeSearch).filter(Boolean))],
    model,
    modelKey: normalizeSearch(model),
    glassType,
    glassTypeLabel: glassTypeLabels[glassType],
    name,
    eurocode,
    years,
    fromYear,
    toYear,
    yearOptions: yearOptionsFromBounds(fromYear, toYear),
    totalPriceByn,
    stock,
    searchText: normalizeSearch(`${brand.label} ${brand.aliases.join(' ')} ${model} ${name} ${eurocode} ${years}`),
  };
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));

  if (!args.source || args.help) {
    console.log(usage);
    process.exitCode = args.help ? 0 : 1;
    return;
  }

  await loadLocalEnv();
  const pricing = resolvePricingConfig();

  const sourcePath = path.resolve(String(args.source));
  const outputPath = path.resolve(String(args.output || defaultOutput));
  const excludedOutputPath = path.resolve(String(args['excluded-output'] || defaultExcludedOutput));

  const rows = await readRows(sourcePath);
  const publicRows = [];
  const excludedRows = [];
  const invalidRows = [];

  for (const row of rows) {
    const rawName = String(getValue(row, aliases.name) || '').trim();
    const rawEurocode = String(getValue(row, aliases.eurocode) || '').trim();
    const rawPrice = parsePrice(getValue(row, aliases.priceUsd));

    if (!rawName || !Number.isFinite(rawPrice) || rawPrice <= 0) {
      invalidRows.push(row);
      continue;
    }

    const glassType = detectGlassType({ name: rawName, eurocode: rawEurocode });
    const reviewReason = getReviewReason({
      name: rawName,
      eurocode: rawEurocode,
      glassType,
      glassPriceUsd: rawPrice,
    });

    if (isExplicitlyExcluded(row) || reviewReason) {
      excludedRows.push({ ...row, _reviewReason: reviewReason || 'explicitly-excluded' });
      continue;
    }

    publicRows.push(normalizeRow(row, publicRows.length + 1, pricing));
  }

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(`${outputPath}.tmp`, `${JSON.stringify(publicRows, null, 2)}\n`, 'utf8');
  await fs.rename(`${outputPath}.tmp`, outputPath);

  if (excludedRows.length) {
    await fs.mkdir(path.dirname(excludedOutputPath), { recursive: true });
    await fs.writeFile(excludedOutputPath, `${JSON.stringify(excludedRows, null, 2)}\n`, 'utf8');
  }

  const brands = new Set(publicRows.map((row) => row.brand));
  const models = new Set(publicRows.map((row) => `${row.brand} ${row.model}`));

  console.log(`Source rows: ${rows.length}`);
  console.log(`Published rows: ${publicRows.length}`);
  console.log(`Brands: ${brands.size}`);
  console.log(`Brand/model groups: ${models.size}`);
  console.log(`Excluded rows: ${excludedRows.length}`);
  console.log(`Invalid rows skipped: ${invalidRows.length}`);
  console.log(`Updated: ${path.relative(rootDir, outputPath)}`);

  if (excludedRows.length) {
    console.log(`Excluded review file: ${path.relative(rootDir, excludedOutputPath)}`);
  }
};

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
