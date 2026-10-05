// node worker/test.mjs : signs with a throwaway key and checks the result with the same rules the app uses (Ed25519 over the payload bytes)
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { signLicense, verifyStripe } from './src/index.js';
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
