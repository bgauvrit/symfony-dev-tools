import type {
  DiagramFilterState,
  DiagramSummary,
  EntityDiagramModel,
} from './features/entities/model';
import type { TranslationStateSnapshot } from './features/translations/model';
import type { ActionDescriptor } from './features/tasks/actionsView';

export interface DiagramStateSnapshot {
  isOpen: boolean;
  model?: EntityDiagramModel;
  filterState: DiagramFilterState;
  domains: string[];
  visibleEntityIds: string[];
  warnings: string[];
  summary?: DiagramSummary;
  hasSvg: boolean;
}

export interface SymfonyDoctrineToolsApi {
  getActionsSnapshot(): Promise<ActionDescriptor[]>;
  getDiagramState(): DiagramStateSnapshot;
  updateDiagramFilters(nextState: Partial<DiagramFilterState>): Promise<void>;
  getTranslationState(): TranslationStateSnapshot;
  scanTranslations(): Promise<void>;
}
