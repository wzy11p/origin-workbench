export type StudioKind =
  | 'capture'
  | 'material'
  | 'citation'
  | 'insight'
  | 'assumption'
  | 'decision'
  | 'preference'
  | 'canvas'
  | 'artifact'
  | 'workflow'
  | 'review'
  | 'blueprint'
  | 'requirement'
  | 'validation';
export type StudioBody = Record<string, unknown>;
export type StudioProject = {
  id: string;
  title: string;
  intent: string;
  stage: string;
  archived: boolean;
  createdAt: number;
  updatedAt: number;
};
export type StudioItem = {
  id: string;
  projectId: string | null;
  kind: StudioKind;
  title: string;
  body: StudioBody;
  status: string;
  version: number;
  createdAt: number;
  updatedAt: number;
};
export type StudioVersion = { itemId: string; version: number; snapshot: StudioItem; createdAt: number };
export type StudioPack = {
  format: 'yuandian-project';
  schema: 1;
  project: StudioProject;
  items: StudioItem[];
  versions: StudioVersion[];
  checksum: string;
};
export type StudioPatch = { title?: string; body?: StudioBody; status?: string };
export type StudioConnection = { port: number; token: string };
export type StudioMethod = {
  id: string;
  title: string;
  description: string;
  source: string;
  version: string;
  steps: { title: string; question: string; hint: string }[];
  content: string;
};
export type StudioBlock = { id: string; text: string; page?: number; bbox?: unknown; label: string };
export type StudioModel = { providerId: string; providerName: string; model: string };
