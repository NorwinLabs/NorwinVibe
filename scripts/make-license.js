// Issues a license key after a customer pays:   node scripts/make-license.js cyberpunk "order-or-email"
// Send the printed key to the buyer; they paste it into Theme Store > Redeem.
const crypto = require('crypto'), fs = require('fs'), path = require('path');
const [item, ref = ''] = process.argv.slice(2);
if (!item) { console.error('Usage: node scripts/make-license.js <item> [order-ref]'); process.exit(1); }
const priv = crypto.createPrivateKey(fs.readFileSync(path.join(__dirname, '..', '.licensing', 'private.pem')));
const payload = Buffer.from(JSON.stringify({ item, ref, ts: Date.now() }));
console.log(payload.toString('base64url') + '.' + crypto.sign(null, payload, priv).toString('base64url'));
