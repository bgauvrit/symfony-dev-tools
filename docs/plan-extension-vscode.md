# Plan de refonte du diagramme UML Doctrine

## Resume

- Le scan Doctrine TypeScript et le modele de donnees existant restent la source de verite.
- Mermaid est retire du pipeline UML.
- Le rendu passe sur Graphviz JS via `@viz-js/viz`, execute dans l extension puis affiche en SVG dans un `WebviewPanel`.
- La V1 cible un graphe complet lisible avec clic ouverture de fichier, zoom, pan, auto-refresh, recherche et filtres par domaine.

## Architecture retenue

- Le scanner Doctrine continue de produire `EntityDiagramModel`.
- Le filtrage est gere cote extension avec `DiagramFilterState { query, includedDomains }`.
- Le rendu Graphviz est calcule cote extension pour envoyer au webview:
  - `svg`
  - `warnings`
  - `domains`
  - `filterState`
  - `visibleEntityIds`
  - `summary`
- Le webview reste leger en HTML, CSS et JavaScript natifs.

## Rendu Graphviz

- Utiliser `@viz-js/viz` et un objet `Graph` plutot qu un DOT texte brut.
- Construire un graphe oriente `rankdir=LR`.
- Creer un cluster Graphviz par domaine Doctrine.
- Creer un noeud par entite avec un label HTML en tableau.
- Limiter l affichage a 6 champs scalaires par noeud, puis afficher `... +N more`.
- Porter les relations sur les aretes avec multiplicites source et cible, ainsi que le label de propriete.
- Attribuer a chaque noeud un `URL` de type `entity://...` pour le clic d ouverture de fichier.

## Recherche et filtres

- Ajouter un champ de recherche dans le panneau UML.
- Ajouter des filtres multi-selection par domaine.
- Sans recherche: afficher toutes les entites des domaines selectionnes.
- Avec recherche: matcher `name`, `namespace` et `domain`, puis garder aussi les voisins de premier niveau.
- Ne conserver que les aretes dont les deux extremites restent visibles.
- Conserver l etat de filtre actif apres refresh manuel ou automatique.

## Robustesse

- Garder le panel central comme UX principale du diagramme.
- Conserver les commandes publiques existantes:
  - `symfonyDoctrineTools.openEntityDiagram`
  - `symfonyDoctrineTools.refreshEntityDiagram`
  - `symfonyDoctrineTools.openEntityFile`
- En cas d echec de rendu Graphviz, conserver le dernier SVG valide si disponible.
- Stabiliser le packaging via `package.json.files` sans `.vscodeignore`.
- Verifier que le `.vsix` contient bien `@viz-js/viz` et `php-parser`.

## Plan de test

- Tests unitaires du scanner Doctrine sur les fixtures Biothanimo-like.
- Tests unitaires du filtrage: domaines, recherche et expansion au voisinage 1.
- Tests unitaires du builder Graphviz: clusters, multiplicites, absence de doublons, URLs cliquables, limitation des champs.
- Tests d integration extension host: ouverture du panel, refresh manuel, auto-refresh, conservation des filtres et ouverture du bon fichier PHP.
- Recette manuelle sur Biothanimo pour verifier lisibilite, zoom, filtres `Catalog` et `Orders`, ainsi que les recherches `Product`, `Order` et `Option`.
