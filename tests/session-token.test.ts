/**
 * Offline tests for Shopify session token verification.
 *
 * This is the function that decides whether a request to the admin API is genuine. Every
 * authenticated route in the app sits behind it, so the tests below are mostly attacks
 * rather than happy paths: the classic JWT failures are `alg: none`, a token signed with
 * the wrong key, an expired token accepted because only the payload was read, and a token
 * minted for a different app.
 *
 * Compile and run (no test runner needed, and no database — this module imports nothing):
 *
 *   npx tsc tests/session-token.test.ts --outDir ./.rmtest --module commonjs \
 *     --target es2022 --moduleResolution node --esModuleInterop --skipLibCheck
 *   node ./.rmtest/tests/session-token.test.js
 */

import assert from 'node:assert';
import crypto from 'node:crypto';

const API_KEY = 'test-client-id-123';
const SECRET = 'test-shared-secret-value';

// Set before importing the module — it reads these at module load.
process.env.SHOPIFY_API_KEY = API_KEY;
process.env.SHOPIFY_API_SECRET = SECRET;

/* eslint-disable @typescript-eslint/no-var-requires */
const { verifySessionToken, sessionTokenFromRequest, SessionTokenError } =
  require('../src/lib/session-token') as typeof import('../src/lib/session-token');

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ok    ${name}`);
  } catch (err) {
    failed++;
    console.error(`  FAIL  ${name}`);
    console.error(`        ${err instanceof Error ? err.message : String(err)}`);
  }
}

function b64(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}

function sign(headerB64: string, payloadB64: string, secret = SECRET): string {
  return crypto.createHmac('sha256', secret).update(`${headerB64}.${payloadB64}`).digest('base64url');
}

const now = () => Math.floor(Date.now() / 1000);

function makeToken(overrides: Record<string, unknown> = {}, opts: { secret?: string; header?: object } = {}) {
  const header = opts.header ?? { alg: 'HS256', typ: 'JWT' };
  const payload = {
    iss: 'https://acme-store.myshopify.com/admin',
    dest: 'https://acme-store.myshopify.com',
    aud: API_KEY,
    sub: '42',
    exp: now() + 60,
    nbf: now() - 5,
    iat: now() - 5,
    jti: 'f8912129-1af6-4cad-9ca3-76b0f7621087',
    sid: 'abc123',
    ...overrides,
  };
  const h = b64(header);
  const p = b64(payload);
  return `${h}.${p}.${sign(h, p, opts.secret)}`;
}

function rejects(token: string, expected: RegExp) {
  try {
    verifySessionToken(token);
  } catch (err) {
    assert.ok(err instanceof SessionTokenError, `wrong error type: ${err}`);
    assert.match(err.message, expected);
    return;
  }
  throw new Error('token was ACCEPTED but should have been rejected');
}

console.log('\nValid tokens');

test('accepts a well-formed token and returns the bare shop domain', () => {
  const s = verifySessionToken(makeToken());
  assert.strictEqual(s.shop, 'acme-store.myshopify.com');
  assert.strictEqual(s.userId, '42');
  assert.strictEqual(s.sessionId, 'abc123');
});

test('accepts dest without a scheme', () => {
  const s = verifySessionToken(makeToken({ dest: 'acme-store.myshopify.com', iss: 'acme-store.myshopify.com/admin' }));
  assert.strictEqual(s.shop, 'acme-store.myshopify.com');
});

test('normalises an uppercase shop domain', () => {
  const s = verifySessionToken(makeToken({ dest: 'https://ACME-Store.myshopify.com', iss: 'https://ACME-Store.myshopify.com/admin' }));
  assert.strictEqual(s.shop, 'acme-store.myshopify.com');
});

test('tolerates a token that expired within the clock-skew window', () => {
  const s = verifySessionToken(makeToken({ exp: now() - 5 }));
  assert.strictEqual(s.shop, 'acme-store.myshopify.com');
});

console.log('\nSignature forgery');

test('rejects a token signed with the wrong secret', () => {
  rejects(makeToken({}, { secret: 'attacker-secret' }), /Invalid signature/);
});

test('rejects alg:none with an empty signature', () => {
  const h = b64({ alg: 'none', typ: 'JWT' });
  const p = b64({ dest: 'https://evil.myshopify.com', iss: 'https://evil.myshopify.com/admin', aud: API_KEY, sub: '1', exp: now() + 60, nbf: now() - 5 });
  rejects(`${h}.${p}.`, /Invalid signature/);
});

test('rejects a payload tampered with after signing', () => {
  const token = makeToken();
  const [h, , sig] = token.split('.');
  const forged = b64({
    iss: 'https://victim.myshopify.com/admin', dest: 'https://victim.myshopify.com',
    aud: API_KEY, sub: '1', exp: now() + 60, nbf: now() - 5,
  });
  rejects(`${h}.${forged}.${sig}`, /Invalid signature/);
});

test('rejects a correctly-signed token whose header claims a different algorithm', () => {
  // Signed properly, so the signature check passes — the alg pin is what stops it.
  rejects(makeToken({}, { header: { alg: 'HS512', typ: 'JWT' } }), /Unexpected algorithm/);
});

test('rejects a truncated signature', () => {
  const t = makeToken();
  const [h, p, sig] = t.split('.');
  rejects(`${h}.${p}.${sig.slice(0, 10)}`, /Invalid signature/);
});

console.log('\nMalformed input');

test('rejects a token with the wrong number of segments', () => {
  rejects('one.two', /Malformed token/);
  rejects('a.b.c.d', /Malformed token/);
});

test('rejects an empty string', () => {
  rejects('', /Malformed token/);
});

console.log('\nClaim validation');

test('rejects an expired token', () => {
  rejects(makeToken({ exp: now() - 120 }), /expired/i);
});

test('rejects a token that is not yet valid', () => {
  rejects(makeToken({ nbf: now() + 120 }), /not yet valid/i);
});

test('rejects a missing exp rather than treating it as no expiry', () => {
  rejects(makeToken({ exp: undefined }), /expired/i);
});

test('rejects a token minted for a different app', () => {
  rejects(makeToken({ aud: 'some-other-app-client-id' }), /audience/i);
});

test('rejects when iss and dest describe different shops', () => {
  rejects(
    makeToken({ iss: 'https://attacker.myshopify.com/admin', dest: 'https://victim.myshopify.com' }),
    /issuer and destination/i
  );
});

test('rejects a non-Shopify destination', () => {
  rejects(makeToken({ iss: 'https://evil.example.com/admin', dest: 'https://evil.example.com' }), /not a Shopify domain/i);
});

test('rejects a destination that merely ends with the Shopify domain', () => {
  rejects(
    makeToken({ iss: 'https://evil.com-myshopify.com/admin', dest: 'https://evil.com-myshopify.com' }),
    /not a Shopify domain/i
  );
});

test('rejects a path-traversal attempt in dest', () => {
  rejects(
    makeToken({ iss: 'https://acme.myshopify.com.evil.com/admin', dest: 'https://acme.myshopify.com.evil.com' }),
    /not a Shopify domain/i
  );
});

console.log('\nHeader extraction');

test('reads a Bearer token, case-insensitively', () => {
  const r1 = new Request('https://x.test', { headers: { Authorization: 'Bearer abc.def.ghi' } });
  assert.strictEqual(sessionTokenFromRequest(r1), 'abc.def.ghi');
  const r2 = new Request('https://x.test', { headers: { authorization: 'bearer abc.def.ghi' } });
  assert.strictEqual(sessionTokenFromRequest(r2), 'abc.def.ghi');
});

test('returns null when there is no Authorization header', () => {
  assert.strictEqual(sessionTokenFromRequest(new Request('https://x.test')), null);
});

test('returns null for a non-Bearer scheme, so Basic auth is never mistaken for a token', () => {
  const r = new Request('https://x.test', { headers: { Authorization: 'Basic dXNlcjpwYXNz' } });
  assert.strictEqual(sessionTokenFromRequest(r), null);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
