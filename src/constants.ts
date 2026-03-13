export const EXTENSION_NAMESPACE = 'symfonyDevTools';

export const COMMANDS = {
  runTask: 'symfonyDevTools.runTask',
  openEntityDiagram: 'symfonyDevTools.openEntityDiagram',
  refreshEntityDiagram: 'symfonyDevTools.refreshEntityDiagram',
  openEntityFile: 'symfonyDevTools.openEntityFile',
  scanTranslations: 'symfonyDevTools.scanTranslations',
  openTranslationsReport: 'symfonyDevTools.openTranslationsReport',
  syncTranslations: 'symfonyDevTools.syncTranslations',
  insertTemplate: 'symfonyDevTools.insertTemplate',
  createSymfonyProject: 'symfonyDevTools.createSymfonyProject',
  applyTranslationFix: 'symfonyDevTools.internal.applyTranslationFix',
  applyTranslationAnnotationFix: 'symfonyDevTools.internal.applyTranslationAnnotationFix',
  openTranslationIssue: 'symfonyDevTools.internal.openTranslationIssue',
  openTranslationPeer: 'symfonyDevTools.internal.openTranslationPeer',
  openWebTargets: 'symfonyDevTools.internal.openWebTargets',
} as const;

export const VIEW_IDS = {
  container: 'symfonyDoctrineTools',
  actions: 'symfonyDoctrineTools.actions',
  diagram: 'symfonyDoctrineTools.diagram',
  translations: 'symfonyDoctrineTools.translations',
} as const;

export const PANEL_IDS = {
  entityDiagram: 'symfonyDoctrineTools.entityDiagramPanel',
} as const;
