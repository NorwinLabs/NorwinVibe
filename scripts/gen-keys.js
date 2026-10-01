// One-time: generates the Ed25519 keypair used to sign and verify theme license keys.
//   licensing/public.pem   -> shipped inside the app (verifies keys)
//   .licensing/private.pem -> KEEP SECRET, never commit or ship (signs keys; used by make-license.js)
const crypto = require('crypto'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
if (fs.existsSync(path.join(root, '.licensing', 'private.pem'))) { console.error('Keys already exist; refusing to overwrite.'); process.exit(1); }
const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
fs.mkdirSync(path.join(root, 'licensing'), { recursive: true });
fs.mkdirSync(path.join(root, '.licensing'), { recursive: true });
fs.writeFileSync(path.join(root, 'licensing', 'public.pem'), publicKey.export({ type: 'spki', format: 'pem' }));
fs.writeFileSync(path.join(root, '.licensing', 'private.pem'), privateKey.export({ type: 'pkcs8', format: 'pem' }));
console.log('Created licensing/public.pem and .licensing/private.pem');
