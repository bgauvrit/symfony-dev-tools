# Plan produit - Symfony Dev Tools

## Resume

- L extension devient un assistant Symfony oriente editeur.
- Les outils Doctrine existants restent disponibles, mais ils ne sont plus le centre du produit.
- La priorite actuelle est l audit et la sync des traductions Symfony.

## Piliers

### V1 - Traductions

- audit PHP + Twig + YAML Symfony
- diagnostics inline
- vue `Translations`
- quick fixes
- sync avec preview cible

### V2 - Templates contextuels

- insertion depuis le fichier actif
- Twig page / partial
- action de controller Symfony
- bloc `buildForm()` Symfony

### V3 - Bootstrap projet

- creation guidee de projet Symfony
- preset web complet
- modules Twig, Security, Translation, Encore, Stimulus, Turbo, Maker, PHPUnit et EasyAdmin

## Commandes publiques

- `symfonyDevTools.scanTranslations`
- `symfonyDevTools.openTranslationsReport`
- `symfonyDevTools.syncTranslations`
- `symfonyDevTools.insertTemplate`
- `symfonyDevTools.createSymfonyProject`
- `symfonyDevTools.runTask`
- `symfonyDevTools.openEntityDiagram`
- `symfonyDevTools.refreshEntityDiagram`
- `symfonyDevTools.openEntityFile`

## Hypotheses retenues

- locale de reference par defaut: `fr`
- sync par defaut: creation de cles vides
- support initial des traductions: YAML Symfony
- usages dynamiques exclus via commentaires inline
- UI principale: editeur + vues `Actions` et `Translations`
