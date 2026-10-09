# Exercice photo hébergé

La page de participation affiche une mention courte de la prise et de l’envoi d’une photo, sans aperçu vidéo. Oui déclenche une seule capture après autorisation du navigateur. Aucun son. Non annule avant l’envoi.

## Comptes administrateurs

Ouvrir `/admin`, puis « Créer mon compte administrateur ». Chaque personne choisit un identifiant de 3 à 32 caractères et un mot de passe de 12 à 128 caractères. Les identifiants sont normalisés en minuscules et réservés atomiquement pour éviter qu’une inscription concurrente écrase un compte. Les mots de passe sont dérivés avec PBKDF2-SHA256, 100 000 itérations et un sel aléatoire ; ils ne sont jamais stockés en clair.

Après connexion, le compte affiche son lien `/?organizer=<id>` à partager et sa galerie. Le serveur impose le propriétaire d’après la session, jamais d’après un identifiant fourni par le navigateur pour lire les photos. Les sessions expirent après une heure et sont supprimées à la déconnexion. Il n’y a pas de réinitialisation de mot de passe dans cette version.

L’ancien compte `admin` et les photos déjà reçues restent accessibles avec `ADMIN_PASSWORD`. Cet identifiant est réservé. Les nouveaux comptes n’utilisent pas ce secret. Sa copie locale `.env` reste exclue de Git et du déploiement.

Cette version remplace Python par un Worker et conserve les données dans R2 privé. Les anciennes photos locales ne sont pas transférées. Maximum par photo : 2 Mo ; maximum de 200 photos par galerie. Les contrôles de débit et de capacité basés sur R2 ne constituent pas des quotas atomiques sous requêtes simultanées.

Construire avec `npm run build` ; vérifier avec `npm run validate` et `node scripts/check-api.mjs`. Les tests utilisent un stockage simulé et vérifient notamment deux comptes, leurs liens, leurs connexions, les accès croisés refusés et la conservation de l’ancienne galerie. La caméra réelle et WebMCP restent à valider dans un navigateur compatible.

Stockage : `photos/` pour l’ancienne galerie ; `admin-photos/<id>/` pour chaque nouvelle galerie ; `accounts/<username>` pour les identifiants et dérivés de mots de passe ; `organizers/<id>` pour les destinataires publics ; `sessions/` et `limits/` pour les sessions et compteurs. Ne jamais rendre le bucket public. Les sessions expirées et les compteurs anciens peuvent être effacés périodiquement.

Les écritures conditionnelles et la dérivation des mots de passe suivent les API documentées par [Cloudflare R2](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/) et [Web Crypto](https://developers.cloudflare.com/workers/runtime-apis/web-crypto/).
