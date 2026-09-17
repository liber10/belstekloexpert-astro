import crypto from 'node:crypto';

const DANGEROUS_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

export class CanonicalJsonError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CanonicalJsonError';
  }
}

function fail(path, message) {
  throw new CanonicalJsonError(`${path}: ${message}`);
}

function canonicalize(value, path, ancestors) {
  if (value === null) return 'null';

  switch (typeof value) {
    case 'boolean':
    case 'string':
      return JSON.stringify(value);
    case 'number': {
      if (!Number.isFinite(value)) fail(path, 'non-finite numbers are not supported.');
      if (Number.isInteger(value) && !Number.isSafeInteger(value)) {
        fail(path, 'unsafe integers are not supported.');
      }
      return JSON.stringify(Object.is(value, -0) ? 0 : value);
    }
    case 'undefined':
    case 'function':
    case 'symbol':
    case 'bigint':
      fail(path, `values of type ${typeof value} are not supported.`);
      break;
    default:
      break;
  }

  if (ancestors.has(value)) fail(path, 'cyclic values are not supported.');
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype) {
        fail(path, 'array subclasses are not supported.');
      }
      if (Object.getOwnPropertySymbols(value).length > 0) {
        fail(path, 'symbol properties are not supported.');
      }
      const ownNames = Object.getOwnPropertyNames(value).filter((key) => key !== 'length');
      for (const key of ownNames) {
        if (DANGEROUS_KEYS.has(key)) fail(`${path}.${key}`, 'prototype-dangerous keys are forbidden.');
        if (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length) {
          fail(`${path}.${key}`, 'non-index array properties are not supported.');
        }
      }
      const items = [];
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.hasOwn(value, index)) fail(`${path}[${index}]`, 'sparse arrays are not supported.');
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor || !('value' in descriptor)) {
          fail(`${path}[${index}]`, 'accessor properties are not supported.');
        }
        items.push(canonicalize(descriptor.value, `${path}[${index}]`, ancestors));
      }
      return `[${items.join(',')}]`;
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      fail(path, 'only plain objects are supported.');
    }
    if (Object.getOwnPropertySymbols(value).length > 0) {
      fail(path, 'symbol properties are not supported.');
    }

    const keys = Object.getOwnPropertyNames(value).sort();
    const properties = [];
    for (const key of keys) {
      if (DANGEROUS_KEYS.has(key)) fail(`${path}.${key}`, 'prototype-dangerous keys are forbidden.');
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
        fail(`${path}.${key}`, 'only enumerable data properties are supported.');
      }
      properties.push(`${JSON.stringify(key)}:${canonicalize(descriptor.value, `${path}.${key}`, ancestors)}`);
    }
    return `{${properties.join(',')}}`;
  } finally {
    ancestors.delete(value);
  }
}

export function canonicalJson(value) {
  return canonicalize(value, '$', new Set());
}

export function taggedSha256(tag, value) {
  if (typeof tag !== 'string' || tag.length === 0 || tag.length > 200 || tag.includes('\0')) {
    throw new CanonicalJsonError('Hash tag must be a non-empty string of at most 200 characters without NUL bytes.');
  }
  const digest = crypto
    .createHash('sha256')
    .update(tag, 'utf8')
    .update(Buffer.from([0]))
    .update(canonicalJson(value), 'utf8')
    .digest('hex');
  return `sha256:${digest}`;
}
