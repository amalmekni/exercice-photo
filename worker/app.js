const PHOTO_PREFIX = 'photos/';
const PHOTO_LIMIT = 200;
const encoder = new TextEncoder();
function reply(status, body = '', mime = 'text/plain; charset=utf-8', extra = {}) {
  return new Response(body, {status, headers: {
    'Content-Type': mime, 'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; media-src 'self' blob:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    'Permissions-Policy': 'camera=(self), microphone=()', 'Referrer-Policy': 'no-referrer', ...extra,
  }});
}
const json = (status, value, extra) => reply(status, JSON.stringify(value), 'application/json; charset=utf-8', extra);
async function digest(value) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}
function sessionToken(request) {
  return request.headers.get('Cookie')?.match(/(?:^|;\s*)session=([a-f0-9]{64})(?:;|$)/)?.[1] || '';
}
function cookie(token, age) { return `session=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${age}`; }
async function authenticated(request, env) {
  const token = sessionToken(request);
  if (!token) return false;
  const record = await env.BUCKET.get('sessions/' + await digest(token));
  if (!record) return false;
  const session = await record.json();
  return session.expires > Date.now() && session.passwordHash === await digest(env.ADMIN_PASSWORD || '');
}
async function boundedBody(request, maxBytes) {
  const length = request.headers.get('Content-Length');
  if (length && (!/^\d+$/.test(length) || Number(length) > maxBytes)) return null;
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const {done, value} = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) { await reader.cancel(); return null; }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}
async function rateAllowed(request, env, action, limit, seconds) {
  const ip = request.headers.get('CF-Connecting-IP');
  if (!ip) return false;
  const key = `limits/${action}/${await digest(ip)}`;
  const existing = await env.BUCKET.get(key);
  let state = existing ? await existing.json() : {count: 0, reset: 0};
  if (state.reset <= Date.now()) state = {count: 0, reset: Date.now() + seconds * 1000};
  if (state.count >= limit) return false;
  state.count++;
  await env.BUCKET.put(key, JSON.stringify(state));
  return true;
}
async function handle(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  if (request.method === 'GET') {
    if (assets[path]) return reply(200, assets[path].body, assets[path].mime);
    if (!path.startsWith('/api/photos')) return reply(404, 'Page introuvable.');
    if (!env.BUCKET || !env.ADMIN_PASSWORD) return json(503, {error: 'Galerie temporairement indisponible.'});
    if (!await authenticated(request, env)) return json(401, {error: 'Connexion requise.'});
    if (path === '/api/photos') {
      let cursor;
      const photos = [];
      do {
        const result = await env.BUCKET.list({prefix: PHOTO_PREFIX, limit: 1000, ...(cursor ? {cursor} : {})});
        for (const item of result.objects) {
          const name = item.key.slice(PHOTO_PREFIX.length);
          photos.push({url: '/api/photos/' + name, name: name.replace(/\.jpg$/, '')});
        }
        cursor = result.truncated ? result.cursor : undefined;
      } while (cursor);
      photos.sort((a, b) => b.name.localeCompare(a.name));
      return json(200, photos);
    }
    const name = path.slice('/api/photos/'.length);
    if (!/^\d{13}-[a-f0-9-]{36}\.jpg$/.test(name)) return reply(404);
    const photo = await env.BUCKET.get(PHOTO_PREFIX + name);
    return photo ? reply(200, photo.body, 'image/jpeg') : reply(404);
  }
  if (request.method !== 'POST') return reply(405, 'Méthode non autorisée.', undefined, {Allow: 'GET, POST'});
  if (!['/api/login', '/api/logout', '/api/upload'].includes(path)) return reply(404);
  const origin = request.headers.get('Origin');
  if (!origin || origin !== url.origin || request.headers.get('Sec-Fetch-Site') === 'cross-site') return reply(403);
  if (!env.BUCKET || !env.ADMIN_PASSWORD) return json(503, {error: 'Service temporairement indisponible.'});
  if (path === '/api/login') {
    if (!await rateAllowed(request, env, 'login', 10, 900)) return json(429, {error: 'Trop de tentatives. Réessayez dans 15 minutes.'}, {'Retry-After': '900'});
    const body = await boundedBody(request, 4096);
    if (!body) return reply(413);
    let credentials;
    try { credentials = JSON.parse(new TextDecoder().decode(body)); } catch { return reply(400); }
    if (credentials?.username !== 'admin' || typeof credentials.password !== 'string') return reply(401);
    const expected = await digest(env.ADMIN_PASSWORD);
    const supplied = await digest(credentials.password);
    let mismatch = 0;
    for (let i = 0; i < expected.length; i++) mismatch |= expected.charCodeAt(i) ^ supplied.charCodeAt(i);
    if (mismatch) return json(401, {error: 'Identifiants incorrects.'});
    const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('');
    await env.BUCKET.put('sessions/' + await digest(token), JSON.stringify({expires: Date.now() + 3600000, passwordHash: expected}));
    return json(200, {}, {'Set-Cookie': cookie(token, 3600)});
  }
  if (path === '/api/logout') {
    const token = sessionToken(request);
    if (token) await env.BUCKET.delete('sessions/' + await digest(token));
    return json(200, {}, {'Set-Cookie': cookie('', 0)});
  }
  if (request.headers.get('X-Photo-Consent') !== 'yes' || request.headers.get('Content-Type') !== 'image/jpeg') return reply(400, 'Consentement et photo JPEG requis.');
  if (!await rateAllowed(request, env, 'upload', 10, 3600)) return reply(429, 'Trop de photos envoyées. Réessayez plus tard.', undefined, {'Retry-After': '3600'});
  const existing = await env.BUCKET.list({prefix: PHOTO_PREFIX, limit: PHOTO_LIMIT});
  if (existing.objects.length >= PHOTO_LIMIT) return reply(507, 'Galerie pleine.');
  const photo = await boundedBody(request, 2_000_000);
  if (!photo) return reply(413, 'Photo trop volumineuse.');
  if (photo.length < 4 || photo[0] !== 255 || photo[1] !== 216 || photo[2] !== 255 || photo.at(-2) !== 255 || photo.at(-1) !== 217) return reply(400, 'Photo JPEG invalide.');
  const name = `${Date.now()}-${crypto.randomUUID()}.jpg`;
  await env.BUCKET.put(PHOTO_PREFIX + name, photo, {httpMetadata: {contentType: 'image/jpeg'}});
  return json(201, {received: true});
}
export default {
  async fetch(request, env, ctx) {
    try { return await handle(request, env); }
    catch { return json(503, {error: 'Service temporairement indisponible. Réessayez plus tard.'}); }
  },
};
