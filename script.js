"use strict";
(() => {
  const video = document.getElementById('video');
  const enable = document.getElementById('enableCamera');
  const cancel = document.getElementById('stopCamera');
  const status = document.getElementById('status');
  const error = document.getElementById('errorMessage');
  const canvas = document.getElementById('photoCanvas');
  let stream = null;
  let generation = 0;
  const cameraSupported = window.isSecureContext && Boolean(navigator.mediaDevices?.getUserMedia);
  const organizer = new URLSearchParams(window.location.search).get('organizer') || 'legacy';
  let organizerReady = false;
  let organizerName = '';
  async function loadOrganizer() {
    try {
      const response = await fetch('/api/organizer?organizer=' + encodeURIComponent(organizer));
      if (!response.ok) throw new Error(response.status === 404 ? 'Lien de participation invalide. Demandez un nouveau lien à l’organisateur.' : 'Service indisponible. Rechargez la page plus tard.');
      const account = await response.json();
      organizerName = account.username;
      organizerReady = true;
      enable.disabled = !cameraSupported;
    } catch (failure) { error.textContent = failure.message; }
  }
  function release() {
    if (stream) stream.getTracks().forEach(track => track.stop());
    stream = null;
    video.srcObject = null;
  }
  function cancelCapture() {
    generation++;
    release();
    cancel.disabled = true;
    enable.disabled = !cameraSupported || !organizerReady;
    status.textContent = 'Capture annulée';
    status.className = 'status status-idle';
  }
  if (!cameraSupported) {
    enable.disabled = true;
    error.textContent = 'Ouvrez cette page sur localhost ou en HTTPS dans un navigateur prenant en charge la caméra.';
  }
  enable.addEventListener('click', async () => {
    if (!organizerReady || !cameraSupported) return;
    const accepted = window.confirm(`Acceptez-vous qu’une photo soit prise avec votre caméra et envoyée à la galerie privée de ${organizerName} ? Aucun son ne sera enregistré.`);
    if (!accepted) { cancelCapture(); return; }
    const id = ++generation;
    enable.disabled = true;
    cancel.disabled = false;
    error.textContent = '';
    status.className = 'status status-idle';
    status.textContent = 'Autorisez la caméra pour prendre et envoyer une photo.';
    try {
      const acquired = await navigator.mediaDevices.getUserMedia({video: {width: {ideal: 1280}, height: {ideal: 720}, facingMode: 'user'}, audio: false});
      if (id !== generation) { acquired.getTracks().forEach(t => t.stop()); return; }
      stream = acquired;
      video.srcObject = acquired;
      await video.play();
      await new Promise((resolve, reject) => {
        if (video.readyState >= 2 && video.videoWidth) { resolve(); return; }
        const timer = setTimeout(() => { cleanup(); reject(new Error('La caméra ne fournit aucune image.')); }, 10000);
        function cleanup() { clearTimeout(timer); video.removeEventListener('loadeddata', ready); }
        function ready() { cleanup(); resolve(); }
        video.addEventListener('loadeddata', ready, {once: true});
      });
      if (id !== generation) return;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Capture indisponible.');
      context.drawImage(video, 0, 0);
      release();
      const photo = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.85));
      if (id !== generation) return;
      if (!photo) throw new Error('La capture a échoué.');
      cancel.disabled = true;
      status.textContent = 'Envoi de la photo…';
      const response = await fetch('/api/upload?organizer=' + encodeURIComponent(organizer), {method: 'POST', headers: {'Content-Type': 'image/jpeg', 'X-Photo-Consent': 'yes'}, body: photo, signal: AbortSignal.timeout(30000)});
      if (!response.ok) throw new Error(({429: 'Trop de photos envoyées. Réessayez plus tard.', 507: 'La galerie est pleine. Contactez l’organisateur.', 413: 'La photo est trop volumineuse.'})[response.status] || 'Le serveur a refusé la photo. Réessayez plus tard.');
      status.textContent = 'Photo envoyée.';
      status.className = 'status status-granted';
    } catch (failure) {
      if (id !== generation) return;
      release();
      status.textContent = 'Aucune confirmation de réception';
      status.className = 'status status-denied';
      error.textContent = ({NotAllowedError: 'Autorisation refusée. Aucune photo prise.', NotFoundError: 'Aucune caméra trouvée.', NotReadableError: 'Caméra indisponible ou utilisée par une autre application.'})[failure.name] || failure.message;
      enable.disabled = false;
      cancel.disabled = true;
    } finally {
      if (id === generation) { canvas.width = 0; canvas.height = 0; }
    }
  });
  cancel.addEventListener('click', cancelCapture);
  const context = document.modelContext;
  if (context?.registerTool) {
    const lifecycle = new AbortController();
    try {
      Promise.resolve(context.registerTool({
        name: 'cancel_photo_capture', title: 'Annuler la capture photo',
        description: 'Arrêter une capture caméra en cours avant le début de l’envoi. Ne peut pas rappeler une photo déjà envoyée.',
        inputSchema: {type: 'object', properties: {}, additionalProperties: false},
        annotations: {readOnlyHint: false},
        execute(input) {
          if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length) throw new Error('Aucun paramètre attendu.');
          if (cancel.disabled) return {cancelled: false, status: status.textContent};
          cancelCapture();
          return {cancelled: true, status: status.textContent};
        },
      }, {signal: lifecycle.signal})).catch(() => {});
    } catch {}
    window.addEventListener('pagehide', () => lifecycle.abort(), {once: true});
  }
  window.addEventListener('pagehide', () => { generation++; release(); });
  loadOrganizer();
})();
