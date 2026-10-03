// Sells NorwinVibe license keys: Stripe -> (this Worker) -> signed key emailed to the buyer.
//   POST /stripe-webhook   Stripe `checkout.session.completed`: signs a key and emails it
//   GET  /thanks?session_id=cs_...   page Stripe sends buyers to after paying; shows their key
// Keys have the same format scripts/make-license.js makes: base64url(JSON) + '.' + base64url(ed25519 signature).

const ITEMS = ['pro', 'cyberpunk', 'nightcity'];
const enc = new TextEncoder();
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export async function signLicense(privatePem, item, ref) {
  const der = Uint8Array.from(atob(privatePem.replace(/-----[^-]+-----|\s/g, '')), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'Ed25519' }, false, ['sign']);
  const payload = enc.encode(JSON.stringify({ item, ref, ts: Date.now() }));
  return `${b64u(payload)}.${b64u(await crypto.subtle.sign('Ed25519', key, payload))}`;
}

// Stripe-Signature: t=<unix>,v1=<hmac sha256 of "t.body"> (5 minute tolerance)
export async function verifyStripe(body, header, secret, now = Date.now()) {
  const parts = Object.fromEntries((header || '').split(',').map((p) => p.split('=')));
  if (!parts.t || !parts.v1 || Math.abs(now / 1000 - Number(parts.t)) > 300) return false;
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = hex(await crypto.subtle.sign('HMAC', key, enc.encode(`${parts.t}.${body}`)));
  return mac.length === parts.v1.length && [...mac].reduce((d, c, i) => d | (c.charCodeAt(0) ^ parts.v1.charCodeAt(i)), 0) === 0;
}

function itemFor(session, env) {
  let item = session.metadata && session.metadata.item;
  if (!item && session.payment_link) { try { item = JSON.parse(env.LINK_ITEMS || '{}')[session.payment_link]; } catch { /* bad JSON */ } }
  return ITEMS.includes(item) ? item : null;
}

const NAMES = { pro: 'NorwinVibe Pro', cyberpunk: 'the Cyberpunk theme', nightcity: 'the Night City theme' };

async function sendEmail(env, to, item, key) {
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST', headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: env.FROM_EMAIL, to: [to], subject: `Your NorwinVibe license key`,
      text: `Thanks for buying ${NAMES[item]}!\n\nYour license key:\n\n${key}\n\nTo unlock it: open NorwinVibe > Settings > Theme Store > Redeem, paste the key and confirm. Keep this email; the key works on every device you paste it into.\n`,
    }),
  });
  if (!r.ok) throw new Error(`email failed: ${r.status} ${await r.text()}`);
}

async function webhook(request, env) {
  const body = await request.text();
  if (!(await verifyStripe(body, request.headers.get('Stripe-Signature'), env.STRIPE_WEBHOOK_SECRET))) return new Response('bad signature', { status: 400 });
  const event = JSON.parse(body);
  if (event.type !== 'checkout.session.completed' && event.type !== 'checkout.session.async_payment_succeeded') return new Response('ignored');
  const s = event.data.object;
  if (s.payment_status !== 'paid') return new Response('not paid yet'); // delayed methods send async_payment_succeeded later
  const item = itemFor(s, env);
  if (!item) return new Response('unknown item', { status: 200 }); // not one of ours; 200 so Stripe stops retrying
  if (await env.KEYS.get(`order:${s.id}`)) return new Response('already sent');
  const key = await signLicense(env.LICENSE_PRIVATE_KEY, item, s.id);
  await env.KEYS.put(`order:${s.id}`, JSON.stringify({ item, key }));
  const to = s.customer_details && s.customer_details.email;
  if (to) await sendEmail(env, to, item, key); // a thrown error returns 500 so Stripe retries; the key is already stored
  return new Response('ok');
}

async function thanks(url, env) {
  const id = url.searchParams.get('session_id') || '';
  const rec = /^cs_[A-Za-z0-9_]+$/.test(id) ? await env.KEYS.get(`order:${id}`) : null;
  const o = rec ? JSON.parse(rec) : null;
  const page = (inner) => new Response(`<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>NorwinVibe</title><body style="font:16px system-ui;max-width:560px;margin:10vh auto;padding:0 16px;background:#0c0c12;color:#fff">${inner}`, { headers: { 'Content-Type': 'text/html;charset=utf-8', 'Cache-Control': 'no-store' } });
  if (!o) return page('<h2>Thanks!</h2><p>Your key is being prepared and will be emailed to you in a moment. You can refresh this page too.</p>');
  return page(`<h2>Thanks for buying ${esc(NAMES[o.item])}!</h2><p>Your license key (a copy is on its way by email):</p><textarea readonly rows=5 style="width:100%;font:13px monospace" onclick="this.select()">${esc(o.key)}</textarea><p>Open NorwinVibe &rsaquo; Settings &rsaquo; Theme Store &rsaquo; Redeem and paste it.</p>`);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'POST' && url.pathname === '/stripe-webhook') return webhook(request, env);
    if (request.method === 'GET' && url.pathname === '/thanks') return thanks(url, env);
    return new Response('Not found', { status: 404 });
  },
};
