// Issues a signed license key. Only the holder of .licensing/private.pem can create valid keys.
//
//   node scripts/make-license.js <item> [reference] [--days N]
//
//   items: cyberpunk | nightcity   one theme pack
//          pro                     Pro features, plus every theme pack
//          dev                     developer mode (everything unlocked + the Developer panel). Always expires:
//                                  90 days unless you pass --days. Keep these short-lived and never share them.
//
// Examples:  node scripts/make-license.js cyberpunk "order-123"
//            node scripts/make-license.js dev me --days 30
// Send the printed key to the buyer; they paste it into Settings > Theme Store > Redeem.
const crypto = require('crypto'), fs = require('fs'), path = require('path');
const ITEMS = ['cyberpunk', 'nightcity', 'pro', 'dev'];
const args = process.argv.slice(2);
const di = args.indexOf('--days');
let days = null;
if (di >= 0) { days = parseFloat(args[di + 1]); args.splice(di, 2); if (!Number.isFinite(days)) { console.error('--days needs a number'); process.exit(1); } }
const [item, ref = ''] = args;
if (!ITEMS.includes(item)) { console.error(`Usage: node scripts/make-license.js <${ITEMS.join('|')}> [reference] [--days N]`); process.exit(1); }
if (item === 'dev' && days === null) days = 90;
const priv = crypto.createPrivateKey(fs.readFileSync(path.join(__dirname, '..', '.licensing', 'private.pem')));
const o = { item, ref, ts: Date.now() };
if (days !== null) o.exp = Date.now() + days * 86400000;
const payload = Buffer.from(JSON.stringify(o));
if (o.exp) console.error(`(${item} key expires ${new Date(o.exp).toISOString()})`);
console.log(payload.toString('base64url') + '.' + crypto.sign(null, payload, priv).toString('base64url'));
