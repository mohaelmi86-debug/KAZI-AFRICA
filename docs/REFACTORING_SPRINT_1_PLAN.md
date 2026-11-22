# KAZI AFRICA — Sprint 1: navigation & performance

## Décisions de pilotage
- Périmètre : toute la Super App.
- Stratégie : refactoring progressif, par lots réversibles.
- Sprint prioritaire : Sprint 1 — navigation & performance.
- Branche de travail : `refactor/sprint-1-navigation-performance`.
- Branche cible : `main`.

## Règles de sécurité du refactoring
1. Ne pas fusionner de PR métier existante dans le cadre de ce sprint.
2. Ne pas supprimer de route publique ou privée sans redirection et validation du parcours.
3. Ne pas modifier les règles RBAC, les contrôles serveur, les schémas DB ou les migrations pour des raisons de présentation.
4. Ne jamais partager de cache de données métier entre organisations. Les clés doivent inclure le contexte organisationnel et, si nécessaire, pays/utilisateur.
5. Conserver les liens profonds, les paramètres d'URL, les états d'authentification et les accès directs aux modules.
6. Chaque lot doit produire un commit autonome et vérifiable. Aucun merge automatique vers `main`.

## État initial constaté sur main
- Application React 19 / TypeScript / Vite / React Router.
- `src/App.tsx` importe statiquement les principaux modules métier et les vues légales, puis déclare les routes.
- `AppShell` affiche simultanément `TopNavBar` et `WorkspaceUtilityBar`, ainsi que la barre mobile.
- Le menu footer expose des liens vers les modules, dont `/opportunities` et `/countries`.
- `package.json` expose `lint` (TypeScript `tsc --noEmit`) et `build` (`vite build`), mais aucun script `test` n'est déclaré dans cette branche.
- Le refactoring de navigation doit donc commencer par cartographier les destinations et rôles avant toute suppression de barre ou fusion de parcours.

## Lots du Sprint 1

### Lot 0 — Référence et CI
- Conserver un point de départ immuable (SHA de main au démarrage).
- Vérifier les scripts réellement disponibles.
- Ajouter un contrôle CI reproductible : installation Bun verrouillée, TypeScript, build Vite.
- Ajouter des tests de navigation dédiés dans un lot ultérieur lorsque l'outillage de test est choisi et installé.

Critères :
- CI déclenchée sur push et pull request.
- Le build et le contrôle TypeScript doivent réussir avant validation du lot.
- Aucun secret, environnement de production ou déploiement ne doit être requis.

### Lot 1 — Code splitting des routes
- Charger les pages métier et vues légales avec `React.lazy` et `Suspense`.
- Garder les composants globaux réellement nécessaires au shell (navigation, footer, indicateur hors ligne) dans le chargement initial.
- Fournir un état de chargement accessible et cohérent.
- Ne changer ni les chemins de routes ni les contrôles d'accès.

Critères :
- Toutes les routes existantes restent déclarées.
- Les modules de route sont importés dynamiquement.
- TypeScript et build réussis.
- Les chunks sont visibles dans les artefacts Vite.

### Lot 2 — Navigation unifiée
- Cartographier les destinations de `TopNavBar`, `WorkspaceUtilityBar`, `MobileBottomTabBar`, footer et liens internes.
- Concevoir une navigation desktop unique et un parcours mobile limité à cinq entrées principales.
- Préserver les destinations selon les rôles et les droits réels.
- Ne retirer `WorkspaceUtilityBar` qu'après remplacement de toutes ses destinations et vérification des accès.

Critères :
- Aucun lien métier perdu.
- Pas de doublon de navigation pour une même destination dans le shell.
- Accès clavier, libellés accessibles, affichage mobile validé.

### Lot 3 — Accueil et Hub
- Définir le comportement public de `/` et connecté.
- Absorber les raccourcis/opportunités dans l'accueil sans effacer la route historique.
- Conserver les URLs partagées et les liens profonds.

Critères :
- Tests des états connecté / déconnecté.
- Les anciennes URLs restent fonctionnelles.
- Pas de fuite d'informations privées sur l'accueil public.

### Lot 4 — Cache et chargements partagés
- Mesurer les chargements répétés avant d'introduire un cache partagé.
- Ajouter une couche de cache uniquement si elle réduit effectivement les appels.
- Clés incluant l'identité et le contexte organisationnel lorsque les données sont privées.
- Invalidation lors d'un changement d'organisation, de pays, de rôle ou de session.

Critères :
- Tests de changement d'organisation et de déconnexion.
- Aucun résultat d'une organisation visible dans une autre.
- Pas de cache pour les opérations financières ou mutations sensibles sans stratégie explicite.

### Lot 5 — i18n, RTL et mobile
- Auditer les chaînes visibles des nouveaux éléments de navigation.
- Valider FR/EN/PT/AR et le sens RTL pour l'arabe.
- Vérifier petits écrans et faible largeur réseau/viewport.

Critères :
- Pas de libellé de navigation codé en dur dans une seule langue.
- Navigation utilisable au clavier et au tactile.
- Pas de débordement horizontal sur les largeurs mobiles ciblées.

## Mesures de référence et objectifs
Les valeurs doivent être mesurées sur la version de référence puis comparées après chaque lot :
- Taille du JS initial gzip et nombre de chunks.
- LCP et INP sur les parcours principaux.
- Nombre de chargements répétés des données pays / organisations / plans.
- Taux de réussite des parcours : découverte, connexion, espace personnel, entreprise.
- Régressions : routes 404, erreurs console, erreurs réseau et refus d'accès inattendus.

Objectifs de pilotage :
- Réduction du JavaScript initial sans imposer un pourcentage non mesuré.
- LCP cible inférieur à 2,5 s sur un profil de référence défini.
- Zéro route métier supprimée et zéro régression d'isolation multi-organisation.
- 100 % des contrôles TypeScript et build réussis sur chaque commit de code.

## Stratégie de commits
- Un commit par lot fonctionnel (CI, code splitting, navigation, accueil, cache, i18n).
- Messages conventionnels, par exemple `ci: add sprint 1 quality gate`, `perf: lazy load route modules`.
- Les commits de code ne sont poussés que sur cette branche.
- PR conservée en brouillon jusqu'à validation manuelle du diff, de la CI et des parcours.
- Aucun merge dans `main` sans accord explicite.

## Hors périmètre du Sprint 1
- Fusion des modules métier en un écran monolithique.
- Modifications des API, migrations ou règles d'autorisation serveur.
- Activation de moyens de paiement réels.
- Déploiement production.
