"use strict";
const login = document.getElementById('login');
const controls = document.getElementById('privateControls');
const message = document.getElementById('message');
const gallery = document.getElementById('gallery');
function showLogin() {
  login.hidden = false;
  controls.hidden = true;
  gallery.replaceChildren();
}
async function refresh() {
  message.textContent = 'Chargement…';
  try {
    const response = await fetch('/api/photos');
    if (response.status === 401) { showLogin(); message.textContent = 'Connectez-vous pour voir les photos.'; return; }
    if (!response.ok) throw new Error('Serveur indisponible.');
    const photos = await response.json();
    login.hidden = true;
    controls.hidden = false;
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
    if (!response.ok) throw new Error(response.status === 401 ? 'Identifiant ou mot de passe incorrect.' : 'Connexion impossible.');
    document.getElementById('password').value = '';
    await refresh();
  } catch (error) { message.textContent = error.message; }
  finally { button.disabled = false; }
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
