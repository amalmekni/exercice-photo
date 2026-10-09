import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source = readFileSync('dist/server/index.js', 'utf8');
const {default: worker} = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const storage = new Map();
const BUCKET = {
  async get(key) { const value = storage.get(key); return value === undefined ? null : {body: value, json: async () => JSON.parse(value)}; },
  async put(key, value) { storage.set(key, value); },
  async delete(key) { storage.delete(key); },
  async list({prefix, limit = 1000}) { const entries = [...storage.keys()].filter(key => key.startsWith(prefix)).sort(); return {objects: entries.slice(0, limit).map(key => ({key})), truncated: false}; },
};
const env = {BUCKET, ADMIN_PASSWORD: 'test-only-password-never-deployed'};
const origin = 'https://test.example';
const call = (path, options = {}, customEnv = env) => worker.fetch(new Request(origin + path, options), customEnv, {});
const post = (body, extra = {}) => ({method: 'POST', headers: {Origin: origin, 'CF-Connecting-IP': '192.0.2.1', ...extra}, body});
assert.equal((await call('/')).status, 200);
assert.equal((await call('/styles.css')).status, 200);
assert.equal((await call('/admin')).status, 200);
assert.equal((await call('/api/photos')).status, 401);
assert.equal((await call('/private_data/photo.jpg')).status, 404);
assert.equal((await call('/api/login', post(JSON.stringify({username: 'admin', password: 'bad'})))).status, 401);
assert.equal((await call('/api/login', {method: 'POST', headers: {Origin: 'https://other.example'}})).status, 403);
assert.equal((await call('/api/login', post('null'))).status, 401);
assert.equal((await call('/api/upload', post(new Uint8Array([255,216,255,217]), {'Content-Type':'image/jpeg'}))).status, 400);
const login = await call('/api/login', post(JSON.stringify({username: 'admin', password: env.ADMIN_PASSWORD})));
assert.equal(login.status, 200);
const cookie = login.headers.get('Set-Cookie').split(';')[0];
assert.match(login.headers.get('Set-Cookie'), /HttpOnly; Secure; SameSite=Strict/);
const auth = {headers: {Cookie: cookie}};
assert.deepEqual(await (await call('/api/photos', auth)).json(), []);
const uploadHeaders = {'Content-Type': 'image/jpeg', 'X-Photo-Consent': 'yes'};
assert.equal((await call('/api/upload', post(new Uint8Array([255,216,255,1,255,217]), uploadHeaders))).status, 201);
const photos = await (await call('/api/photos', auth)).json();
assert.equal(photos.length, 1);
assert.equal((await call(photos[0].url)).status, 401);
assert.equal((await call(photos[0].url, auth)).status, 200);
assert.equal((await call('/api/upload', post('not a jpeg', uploadHeaders))).status, 400);
assert.equal((await call('/api/upload', post(new Uint8Array(2_000_001), uploadHeaders))).status, 413);
assert.equal((await call('/api/photos', auth, {...env, ADMIN_PASSWORD: 'rotated'})).status, 401);
assert.equal((await call('/api/logout', {...post(''), headers: {...post('').headers, Cookie: cookie}})).status, 200);
assert.equal((await call('/api/photos', auth)).status, 401);
for (let i = 0; i < 12; i++) await call('/api/login', post('{}'));
assert.equal((await call('/api/login', post('{}'))).status, 429);
const failedStorage = {get: async () => {throw new Error('unavailable');}};
assert.equal((await call('/api/photos', auth, {...env, BUCKET: failedStorage})).status, 503);
console.log('Vérifications API réussies : consentement, stockage, authentification, accès privé, déconnexion et erreurs.');
