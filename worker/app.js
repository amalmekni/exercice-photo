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
const USERNAME = /^[a-z0-9][a-z0-9_-]{2,31}$/;
const ORGANIZER_ID = /^(?:legacy|[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})$/;
const NEW_PHOTO_NAME = /^\d{13}-[a-f0-9-]{36}\.jpg$/;
function normalizeUsername(value) { return typeof value === 'string' ? value.trim().toLowerCase() : ''; }
function equalHashes(expected, supplied) {
  if (expected.length !== supplied.length) return false;
  let mismatch = 0;
  for (let i = 0; i < expected.length; i++) mismatch |= expected.charCodeAt(i) ^ supplied.charCodeAt(i);
  return mismatch === 0;
}
async function passwordHash(password, salt) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({name: 'PBKDF2', salt: encoder.encode(salt), iterations: 100000, hash: 'SHA-256'}, key, 256);
  return Array.from(new Uint8Array(bits), byte => byte.toString(16).padStart(2, '0')).join('');
}
async function accountByUsername(username, env) {
  if (username === 'admin') return env.ADMIN_PASSWORD ? {id: 'legacy', username, hash: await digest(env.ADMIN_PASSWORD), legacy: true} : null;
  if (!USERNAME.test(username)) return null;
  const object = await env.BUCKET.get('accounts/' + username);
  return object ? object.json() : null;
}
async function organizerById(id, env) {
  if (!ORGANIZER_ID.test(id)) return null;
  if (id === 'legacy') return env.ADMIN_PASSWORD ? {id, username: 'admin'} : null;
  const object = await env.BUCKET.get('organizers/' + id);
  return object ? object.json() : null;
}
function photoPrefix(account) { return account.id === 'legacy' ? 'photos/' : `admin-photos/${account.id}/`; }
function publicAccount(account) { return {username: account.username, participationPath: account.id === 'legacy' ? '/' : '/?organizer=' + account.id}; }
async function createSession(account, env) {
  const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('');
  await env.BUCKET.put('sessions/' + await digest(token), JSON.stringify({expires: Date.now() + 3600000, username: account.username, passwordHash: account.hash}));
  return json(200, publicAccount(account), {'Set-Cookie': cookie(token, 3600)});
}
async function authenticated(request, env) {
  const token = sessionToken(request);
  if (!token) return null;
  const record = await env.BUCKET.get('sessions/' + await digest(token));
  if (!record) return null;
  const session = await record.json();
  if (session.expires <= Date.now()) return null;
  const account = await accountByUsername(session.username || 'admin', env);
  return account && equalHashes(session.passwordHash, account.hash) ? account : null;
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
    if (!['/api/organizer', '/api/account', '/api/photos'].includes(path) && !path.startsWith('/api/photos/')) return reply(404, 'Page introuvable.');
    if (!env.BUCKET) return json(503, {error: 'Galerie temporairement indisponible.'});
    if (path === '/api/organizer') {
      const organizer = await organizerById(url.searchParams.get('organizer') || 'legacy', env);
      return organizer ? json(200, {username: organizer.username}) : json(404, {error: 'Lien de participation invalide.'});
    }
    const account = await authenticated(request, env);
    if (!account) return json(401, {error: 'Connexion requise.'});
    if (path === '/api/account') return json(200, publicAccount(account));
    const prefix = photoPrefix(account);
    if (path === '/api/photos') {
      let cursor;
      const photos = [];
      do {
        const result = await env.BUCKET.list({prefix, limit: 1000, ...(cursor ? {cursor} : {})});
        for (const item of result.objects) {
          const name = item.key.slice(prefix.length);
          photos.push({url: '/api/photos/' + name, name: name.replace(/\.jpg$/, '')});
        }
        cursor = result.truncated ? result.cursor : undefined;
      } while (cursor);
      photos.sort((a, b) => b.name.localeCompare(a.name));
      return json(200, photos);
    }
    const name = path.slice('/api/photos/'.length);
    if (!NEW_PHOTO_NAME.test(name)) return reply(404);
    const photo = await env.BUCKET.get(prefix + name);
    return photo ? reply(200, photo.body, 'image/jpeg') : reply(404);
  }
  if (request.method !== 'POST') return reply(405, 'Méthode non autorisée.', undefined, {Allow: 'GET, POST'});
  if (!['/api/register', '/api/login', '/api/logout', '/api/upload'].includes(path)) return reply(404);
  const origin = request.headers.get('Origin');
  if (!origin || origin !== url.origin || request.headers.get('Sec-Fetch-Site') === 'cross-site') return reply(403);
  if (!env.BUCKET) return json(503, {error: 'Service temporairement indisponible.'});
  if (path === '/api/login' || path === '/api/register') {
    const registering = path === '/api/register';
    if (!await rateAllowed(request, env, registering ? 'register' : 'login', registering ? 5 : 10, registering ? 3600 : 900)) return json(429, {error: 'Trop de tentatives. Réessayez plus tard.'}, {'Retry-After': registering ? '3600' : '900'});
    const body = await boundedBody(request, 4096);
    if (!body) return reply(413);
    let credentials;
    try { credentials = JSON.parse(new TextDecoder().decode(body)); } catch { return reply(400); }
    const username = normalizeUsername(credentials?.username);
    if (!USERNAME.test(username) || typeof credentials?.password !== 'string' || credentials.password.length > 128) return json(registering ? 400 : 401, {error: registering ? 'Identifiant : 3 à 32 lettres minuscules, chiffres, tirets ou traits de soulignement.' : 'Identifiants incorrects.'});
    if (registering) {
      if (username === 'admin') return json(409, {error: 'Cet identifiant est réservé. Choisissez le vôtre.'});
      if (credentials.password.length < 12) return json(400, {error: 'Choisissez un mot de passe de 12 caractères minimum.'});
      const salt = crypto.randomUUID();
      const account = {id: crypto.randomUUID(), username, salt, hash: await passwordHash(credentials.password, salt)};
      const created = await env.BUCKET.put('accounts/' + username, JSON.stringify(account), {onlyIf: new Headers({'If-None-Match': '*'})});
      if (!created) return json(409, {error: 'Cet identifiant est déjà utilisé.'});
      await env.BUCKET.put('organizers/' + account.id, JSON.stringify({id: account.id, username}));
      return createSession(account, env);
    }
    const account = await accountByUsername(username, env);
    const supplied = account?.legacy ? await digest(credentials.password) : await passwordHash(credentials.password, account?.salt || 'invalid-account-salt');
    if (!account || !equalHashes(account.hash, supplied)) return json(401, {error: 'Identifiants incorrects.'});
    // Complete a registration interrupted between account and link storage.
    if (!account.legacy && !await env.BUCKET.get('organizers/' + account.id)) await env.BUCKET.put('organizers/' + account.id, JSON.stringify({id: account.id, username}));
    return createSession(account, env);
  }
  if (path === '/api/logout') {
    const token = sessionToken(request);
    if (token) await env.BUCKET.delete('sessions/' + await digest(token));
    return json(200, {}, {'Set-Cookie': cookie('', 0)});
  }
  if (request.headers.get('X-Photo-Consent') !== 'yes' || request.headers.get('Content-Type') !== 'image/jpeg') return reply(400, 'Consentement et photo JPEG requis.');
  const organizer = await organizerById(url.searchParams.get('organizer') || 'legacy', env);
  if (!organizer) return json(404, {error: 'Lien de participation invalide.'});
  const prefix = photoPrefix(organizer);
  if (!await rateAllowed(request, env, 'upload', 10, 3600)) return reply(429, 'Trop de photos envoyées. Réessayez plus tard.', undefined, {'Retry-After': '3600'});
  let cursor;
  let photoCount = 0;
  do {
    const existing = await env.BUCKET.list({prefix, limit: PHOTO_LIMIT, ...(cursor ? {cursor} : {})});
    photoCount += existing.objects.length;
    if (photoCount >= PHOTO_LIMIT) return reply(507, 'Galerie pleine.');
    cursor = existing.truncated ? existing.cursor : undefined;
  } while (cursor);
  const photo = await boundedBody(request, 2_000_000);
  if (!photo) return reply(413, 'Photo trop volumineuse.');
  if (photo.length < 4 || photo[0] !== 255 || photo[1] !== 216 || photo[2] !== 255 || photo.at(-2) !== 255 || photo.at(-1) !== 217) return reply(400, 'Photo JPEG invalide.');
  const name = `${Date.now()}-${crypto.randomUUID()}.jpg`;
  await env.BUCKET.put(prefix + name, photo, {httpMetadata: {contentType: 'image/jpeg'}});
  return json(201, {received: true});
}
export default {
  async fetch(request, env, ctx) {
    try { return await handle(request, env); }
    catch { return json(503, {error: 'Service temporairement indisponible. Réessayez plus tard.'}); }
  },
};
