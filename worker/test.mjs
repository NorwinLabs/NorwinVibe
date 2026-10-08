// node worker/test.mjs : signs with a throwaway key and checks the result with the same rules the app uses (Ed25519 over the payload bytes)
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { signLicense, verifyStripe } from './src/index.js';
try { await crypto.subtle.generateKey({ name: 'Ed25519' }, false, ['sign']); } catch { console.log('skipped: this Node has no Ed25519 in WebCrypto'); process.exit(0); } // (Workers have it; very old Node does not)
const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const key = await signLicense(privateKey.export({ type: 'pkcs8', format: 'pem' }), 'pro', 'cs_test_1');
const [p, sig] = key.split('.');
assert(crypto.verify(null, Buffer.from(p, 'base64url'), publicKey, Buffer.from(sig, 'base64url')), 'signature verifies');
assert.deepEqual(Object.keys(JSON.parse(Buffer.from(p, 'base64url'))).sort(), ['item', 'ref', 'ts']);
const body = '{"x":1}', t = Math.floor(Date.now() / 1000), secret = 'whsec_test';
const v1 = crypto.createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
assert(await verifyStripe(body, `t=${t},v1=${v1}`, secret));
assert(!(await verifyStripe(body + ' ', `t=${t},v1=${v1}`, secret)), 'tampered body rejected');
assert(!(await verifyStripe(body, `t=${t - 1000},v1=${v1}`, secret, Date.now())), 'old timestamp rejected');
console.log('ok');

// ---- end to end: Stripe webhook -> key stored + emailed, retries are harmless, "lost your key?" resends ----
const worker = (await import('./src/index.js')).default;
const kv = new Map();
const env = {
  KEYS: { get: async (k) => kv.get(k) ?? null, put: async (k, v) => { kv.set(k, v); } },
  LICENSE_PRIVATE_KEY: privateKey.export({ type: 'pkcs8', format: 'pem' }), STRIPE_WEBHOOK_SECRET: secret, RESEND_API_KEY: 're_test', FROM_EMAIL: 'Test <t@example.com>', LINK_ITEMS: '{}',
};
const mails = []; const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => { mails.push({ url, body: JSON.parse(init.body) }); return new Response('{}', { status: 200 }); };
const event = (id, item, status = 'paid') => JSON.stringify({ type: 'checkout.session.completed', data: { object: { id, payment_status: status, metadata: { item }, customer_details: { email: 'Buyer@Example.com' } } } });
const post = async (path, body, headers = {}) => worker.fetch(new Request(`https://w.test${path}`, { method: 'POST', body, headers }), env);
const signed = (body) => { const ts = Math.floor(Date.now() / 1000); return { 'Stripe-Signature': `t=${ts},v1=${crypto.createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex')}` }; };

let b1 = event('cs_test_A1', 'pro');
assert.equal((await post('/stripe-webhook', b1, signed(b1))).status, 200);
assert.equal(mails.length, 1); assert(mails[0].body.text.includes('.'), 'the key is in the email'); assert.deepEqual(mails[0].body.to, ['Buyer@Example.com']);
const mailedKey = mails[0].body.text.split('\n').find((l) => l.split('.').length === 2 && l.length > 60);
assert(crypto.verify(null, Buffer.from(mailedKey.split('.')[0], 'base64url'), publicKey, Buffer.from(mailedKey.split('.')[1], 'base64url')), 'the emailed key verifies');
await post('/stripe-webhook', b1, signed(b1)); assert.equal(mails.length, 1, 'a Stripe retry does not send a second email');
assert.equal((await post('/stripe-webhook', b1, { 'Stripe-Signature': 't=1,v1=00' })).status, 400, 'bad signature rejected');
let b2 = event('cs_test_A2', 'pro', 'unpaid'); await post('/stripe-webhook', b2, signed(b2)); assert.equal(mails.length, 1, 'unpaid sessions get no key');
let b3 = event('cs_test_A3', 'bogus'); await post('/stripe-webhook', b3, signed(b3)); assert.equal(mails.length, 1, 'unknown items get no key');
assert((await (await worker.fetch(new Request('https://w.test/thanks?session_id=cs_test_A1'), env)).text()).includes(mailedKey), 'thank-you page shows the key');
// restore
let r = await post('/restore', JSON.stringify({ email: 'buyer@example.com' })); assert.equal((await r.json()).ok, true);
assert.equal(mails.length, 2, 'restore resends the key'); assert(mails[1].body.text.includes(mailedKey));
await post('/restore', JSON.stringify({ email: 'buyer@example.com' })); assert.equal(mails.length, 2, 'rate limited to one per minute');
r = await post('/restore', JSON.stringify({ email: 'stranger@example.com' })); assert.equal((await r.json()).ok, true); assert.equal(mails.length, 2, 'unknown email: same answer, no mail');
assert.equal((await post('/restore', '{"email":"nope"}')).status, 400);
globalThis.fetch = realFetch;
console.log('worker e2e ok');
