# Exercice photo h?berg?

La page / informe le participant avant de demander la cam?ra. Oui d?clenche une seule capture et son envoi ? la galerie priv?e. Aucun son. Non annule avant le d?but de l?envoi.

Galerie : /admin. Identifiant : admin. Le mot de passe ADMIN_PASSWORD est un secret Sites et une copie locale est conserv?e dans .env, exclu de Git et du d?ploiement. Les sessions expirent apr?s une heure. La d?connexion ou le changement de mot de passe les invalide.

Cette version remplace Python par un Worker et conserve les nouvelles photos dans le stockage R2 priv?. Les anciennes photos locales ne sont pas transf?r?es. Maximum par photo : 2 Mo. La galerie refuse les envois lorsqu?elle contient d?j? 200 photos. Les contr?les de d?bit et de capacit? bas?s sur R2 ne constituent pas des quotas atomiques sous requ?tes simultan?es.

Construire avec npm run build ; v?rifier avec npm run validate et node scripts/check-api.mjs.

Stockage : photos/ pour les images ; sessions/ pour les sessions ; limits/ pour les compteurs. Effacer les objets photos/ pour supprimer les images. Ne jamais rendre le bucket public. Les sessions expir?es et les compteurs anciens peuvent ?tre effac?s p?riodiquement.
