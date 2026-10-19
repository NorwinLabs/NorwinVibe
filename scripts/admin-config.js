// Turns the ADMIN_PASSWORD repository secret into the check the apps use to unlock admin mode. Run by CI before the apps are built:
//
//   ADMIN_PASSWORD=... node scripts/admin-config.js
//
// store.config.json gets  "admin": { "check": "<sha256 of the password-derived token>" }.  The password itself is never written anywhere;
// the check cannot be turned back into the password except by guessing it, so choose a long one. Without the variable admin mode is off.
// token = PBKDF2-SHA256(password, "norwinvibe-admin-v1", 100000 rounds, 32 bytes). The apps and the stats service use the same maths.
const crypto = require('crypto'), fs = require('fs'), path = require('path');
const SALT = 'norwinvibe-admin-v1', ROUNDS = 100000;
const adminToken = (pw) => crypto.pbkdf2Sync(String(pw), SALT, ROUNDS, 32, 'sha256').toString('hex');
const adminCheck = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');
module.exports = { adminToken, adminCheck };

if (require.main === module) {
  const file = path.join(__dirname, '..', 'store.config.json'), cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
  const pw = process.env.ADMIN_PASSWORD || '';
  if (pw) { cfg.admin = { check: adminCheck(adminToken(pw)) }; console.log('Admin mode is set up for this build.'); }
  else { delete cfg.admin; console.log('ADMIN_PASSWORD is not set: this build has no admin mode.'); }
  fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + '\n');
}
