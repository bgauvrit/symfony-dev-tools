export interface TextPosition {
  line: number;
  character: number;
}

export interface TextRange {
  start: TextPosition;
  end: TextPosition;
}

export interface RouteDefinition {
  name: string;
  controllerClass: string;
  controllerMethod: string;
  filePath: string;
  attributeRange: TextRange;
  nameRange: TextRange;
  localizedPaths: Record<string, string>;
  requiredParams: string[];
  optionalParams: string[];
  defaults: Record<string, string | number | boolean | null>;
}

export interface RouteUsage {
  routeName: string;
  filePath: string;
  range: TextRange;
  functionName: 'path' | 'url' | 'redirectToRoute' | 'generateUrl';
  source: 'twig' | 'php';
}

export interface TemplateRenderBinding {
  templatePath: string;
  controllerClass: string;
  controllerMethod: string;
  controllerFilePath: string;
  renderRange: TextRange;
  routeNames: string[];
}

export interface FormFieldDefinition {
  name: string;
  range: TextRange;
}

export interface FormBinding {
  templatePath: string;
  formVariable: string;
  formTypeClass: string;
  formTypeFilePath: string;
  formTypeRange: TextRange;
  fieldDefinitions: FormFieldDefinition[];
  controllerClass: string;
  controllerMethod: string;
  controllerFilePath: string;
  easyAdminThemePaths: string[];
}

export interface ThemeBinding {
  themePath: string;
  controllerClass: string;
  controllerMethod: string;
  controllerFilePath: string;
  range: TextRange;
}

export interface NavigationTarget {
  filePath: string;
  range: TextRange;
  label: string;
  description?: string;
}

export interface SymfonyWebIndex {
  routes: RouteDefinition[];
  routeUsages: RouteUsage[];
  templateBindings: TemplateRenderBinding[];
  formBindings: FormBinding[];
  themeBindings: ThemeBinding[];
  warnings: string[];
  generatedAt: string;
}

export function createEmptySymfonyWebIndex(): SymfonyWebIndex {
  return {
    routes: [],
    routeUsages: [],
    templateBindings: [],
    formBindings: [],
    themeBindings: [],
    warnings: [],
    generatedAt: new Date(0).toISOString(),
  };
}

export function normalizeTemplatePath(templatePath: string): string {
  return templatePath.replace(/\\/g, '/').replace(/^\/+/, '');
}
