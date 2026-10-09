import { readFileSync, mkdirSync, writeFileSync, copyFileSync } from 'node:fs';
const files = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/admin': ['admin.html', 'text/html; charset=utf-8'],
  '/styles.css': ['styles.css', 'text/css; charset=utf-8'],
  '/script.js': ['script.js', 'text/javascript; charset=utf-8'],
  '/admin.js': ['admin.js', 'text/javascript; charset=utf-8'],
};
const assets = Object.fromEntries(Object.entries(files).map(([route, [file, mime]]) => [route, {body: readFileSync(file, 'utf8').replace(/^\uFEFF/, ''), mime}]));
mkdirSync('dist/server', {recursive: true});
mkdirSync('dist/.openai', {recursive: true});
writeFileSync('dist/server/index.js', `const assets = ${JSON.stringify(assets)};\n${readFileSync('worker/app.js', 'utf8')}`);
copyFileSync('.openai/hosting.json', 'dist/.openai/hosting.json');
console.log('Application et galerie compilées.');
