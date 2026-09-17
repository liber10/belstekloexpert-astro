import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { canonicalJson, taggedSha256 } from '../src/canonical-json.mjs';

test('canonicalJson sorts object keys and preserves array order', () => {
  const first = { z: [3, { b: true, a: null }], a: 'text', n: -0 };
  const second = { n: 0, a: 'text', z: [3, { a: null, b: true }] };
  const expected = '{"a":"text","n":0,"z":[3,{"a":null,"b":true}]}';
  assert.equal(canonicalJson(first), expected);
  assert.equal(canonicalJson(second), expected);
});

test('canonicalJson rejects unsupported and ambiguous values', () => {
  for (const value of [undefined, () => {}, Symbol('x'), 1n, Number.NaN, Infinity, -Infinity]) {
    assert.throws(() => canonicalJson(value));
  }
  assert.throws(() => canonicalJson({ nested: undefined }), /undefined/);
  assert.throws(() => canonicalJson(Number.MAX_SAFE_INTEGER + 1), /unsafe integers/);

  const sparse = [];
  sparse.length = 1;
  assert.throws(() => canonicalJson(sparse), /sparse arrays/);

  const withExtraArrayProperty = [1];
  withExtraArrayProperty.extra = 2;
  assert.throws(() => canonicalJson(withExtraArrayProperty), /non-index array properties/);
});

test('canonicalJson rejects cycles, exotic objects, accessors, and dangerous keys', () => {
  const cyclic = {};
  cyclic.self = cyclic;
  assert.throws(() => canonicalJson(cyclic), /cyclic/);
  assert.throws(() => canonicalJson(new Date()), /plain objects/);

  const accessor = {};
  Object.defineProperty(accessor, 'value', { enumerable: true, get: () => 1 });
  assert.throws(() => canonicalJson(accessor), /data properties/);

  const dangerous = JSON.parse('{"__proto__":true}');
  assert.throws(() => canonicalJson(dangerous), /prototype-dangerous/);
  assert.throws(() => canonicalJson({ constructor: 'blocked' }), /prototype-dangerous/);
});

test('taggedSha256 domain-separates the canonical payload', () => {
  const value = { b: 2, a: 1 };
  const canonical = '{"a":1,"b":2}';
  const expected = `sha256:${crypto
    .createHash('sha256')
    .update('bundle-plan/v1', 'utf8')
    .update(Buffer.from([0]))
    .update(canonical, 'utf8')
    .digest('hex')}`;
  assert.equal(taggedSha256('bundle-plan/v1', value), expected);
  assert.equal(taggedSha256('bundle-plan/v1', { a: 1, b: 2 }), expected);
  assert.notEqual(taggedSha256('other-domain/v1', value), expected);
  assert.throws(() => taggedSha256('', value), /Hash tag/);
  assert.throws(() => taggedSha256('bad\0tag', value), /Hash tag/);
});
