import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source = readFileSync('script.js', 'utf8');
async function scenario(accepted, validOrganizer = true) {
  const calls = [];
  const elements = new Map();
  for (const id of ['video', 'enableCamera', 'stopCamera', 'status', 'errorMessage', 'photoCanvas']) {
    elements.set(id, {disabled: id === 'enableCamera', textContent: '', className: '', listeners: new Map(), addEventListener(name, fn) {this.listeners.set(name, fn);}, removeEventListener() {}});
  }
  const video = elements.get('video');
  Object.assign(video, {readyState: 2, videoWidth: 1, videoHeight: 1, play: async () => {}});
  const canvas = elements.get('photoCanvas');
  Object.assign(canvas, {getContext: () => ({drawImage: () => calls.push('capture')}), toBlob: fn => fn(new Blob(['photo'], {type: 'image/jpeg'}))});
  vm.runInNewContext(source, {
    document: {getElementById: id => elements.get(id)},
    window: {isSecureContext: true, location: {search: ''}, addEventListener() {}, confirm(message) {
      assert.match(message, /photo/); assert.match(message, /caméra/); assert.match(message, /envoyée/); assert.match(message, /teacher/);
      calls.push('confirmation'); return accepted;
    }},
    navigator: {mediaDevices: {getUserMedia: async () => {calls.push('camera'); return {getTracks: () => [{stop: () => calls.push('stop')}]};}}},
    fetch: async (url, options) => {
      if (url.startsWith('/api/organizer')) return {ok: validOrganizer, status: validOrganizer ? 200 : 404, json: async () => ({username: 'teacher'})};
      assert.equal(options.headers['X-Photo-Consent'], 'yes');
      calls.push('upload'); return {ok: true};
    },
    URLSearchParams, AbortController, AbortSignal, setTimeout, clearTimeout,
  });
  await new Promise(resolve => setImmediate(resolve));
  await elements.get('enableCamera').listeners.get('click')();
  return {calls, elements};
}
const refused = await scenario(false);
assert.deepEqual(refused.calls, ['confirmation']);
const accepted = await scenario(true);
assert.deepEqual(accepted.calls, ['confirmation', 'camera', 'capture', 'stop', 'upload']);
assert.equal(accepted.elements.get('status').textContent, 'Photo envoyée.');
const invalid = await scenario(true, false);
assert.deepEqual(invalid.calls, []);
assert.equal(invalid.elements.get('enableCamera').disabled, true);
console.log('Consentement vérifié : refus sans caméra ni envoi ; acceptation avant capture ; lien invalide bloqué.');
