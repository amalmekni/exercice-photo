"use strict";
const login = document.getElementById('login');
const register = document.getElementById('register');
const authPanel = document.getElementById('authPanel');
const controls = document.getElementById('privateControls');
const message = document.getElementById('message');
const gallery = document.getElementById('gallery');
function showLogin() {
  authPanel.hidden = false;
  controls.hidden = true;
  gallery.replaceChildren();
  document.getElementById('participationLink').value = '';
  document.getElementById('accountName').textContent = '';
}
async function refresh() {
  message.textContent = 'Chargement…';
  try {
    const accountResponse = await fetch('/api/account');
    if (accountResponse.status === 401) { showLogin(); message.textContent = 'Connectez-vous ou créez votre compte.'; return; }
    if (!accountResponse.ok) throw new Error('Connexion au serveur impossible. Réessayez plus tard.');
    const account = await accountResponse.json();
    const response = await fetch('/api/photos');
    if (response.status === 401) { showLogin(); message.textContent = 'Connectez-vous pour voir les photos.'; return; }
    if (!response.ok) throw new Error('Serveur indisponible.');
    const photos = await response.json();
    authPanel.hidden = true;
    controls.hidden = false;
    document.getElementById('accountName').textContent = `Galerie de ${account.username}`;
    document.getElementById('participationLink').value = new URL(account.participationPath, window.location.origin).href;
    gallery.replaceChildren();
    for (const photo of photos) {
      const figure = document.createElement('figure');
      const image = document.createElement('img');
      image.src = photo.url;
      image.alt = 'Photo reçue';
      image.loading = 'lazy';
      image.width = 320;
      const caption = document.createElement('figcaption');
      caption.textContent = photo.name;
      figure.append(image, caption);
      gallery.append(figure);
    }
    message.textContent = `${photos.length} photo(s) reçue(s)`;
  } catch (error) { message.textContent = error.message; }
}
login.addEventListener('submit', async event => {
  event.preventDefault();
  const button = login.querySelector('button');
  button.disabled = true;
  try {
    const response = await fetch('/api/login', {method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({username: document.getElementById('username').value, password: document.getElementById('password').value})});
    if (!response.ok) { const details = await response.json().catch(() => ({})); throw new Error(details.error || 'Connexion impossible.'); }
    document.getElementById('password').value = '';
    await refresh();
  } catch (error) { message.textContent = error.message; }
  finally { button.disabled = false; }
});
register.addEventListener('submit', async event => {
  event.preventDefault();
  const button = register.querySelector('button');
  const password = document.getElementById('registerPassword').value;
  if (password !== document.getElementById('confirmPassword').value) { message.textContent = 'Les deux mots de passe doivent être identiques.'; return; }
  button.disabled = true;
  try {
    const response = await fetch('/api/register', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({username: document.getElementById('registerUsername').value, password})});
    if (!response.ok) { const details = await response.json().catch(() => ({})); throw new Error(details.error || 'Création du compte impossible.'); }
    register.reset();
    login.reset();
    await refresh();
  } catch (error) { message.textContent = error.message; }
  finally { button.disabled = false; }
});
document.getElementById('copyLink').addEventListener('click', async () => {
  const field = document.getElementById('participationLink');
  try { await navigator.clipboard.writeText(field.value); message.textContent = 'Lien copié. Partagez-le avec vos participants.'; }
  catch { field.focus(); field.select(); message.textContent = 'Sélectionnez et copiez votre lien.'; }
});
document.getElementById('logout').addEventListener('click', async () => {
  try {
    const response = await fetch('/api/logout', {method: 'POST'});
    if (!response.ok) throw new Error('Déconnexion impossible.');
    showLogin();
    message.textContent = 'Vous êtes déconnecté.';
  } catch (error) { message.textContent = error.message; }
});
document.getElementById('refresh').addEventListener('click', refresh);
refresh();
