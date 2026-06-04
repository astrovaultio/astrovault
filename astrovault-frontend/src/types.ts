export type Frame = {
  id: number;
  originalFilename: string;
  frameType: string;
  metadata?: string;
  session?: { id: number };
  processingStatus?: string;
  previewStorageKey?: string;
  thumbnailStorageKey?: string;
  sourceName?: string;
  checksum?: string;
  observedAt?: string;
  exposureSeconds?: number;
  cameraName?: string;
};

export type Session = {
  id: number;
  startTime?: string;
  endTime?: string;
  notes?: string;
  totalIntegrationTime?: number;
  logicalGroupKey?: string;
  manualWorkflowStatus?: string;
  target?: { id?: number; name?: string };
  targetEnrichment?: TargetEnrichment;
};

export type Target = { id: number; name: string; type?: string; ra?: number; dec?: number; notes?: string };

export type TargetEnrichment = {
  id: number;
  canonicalName?: string;
  objectType?: string;
  catalogIds?: string;
  constellation?: string;
  ra?: number;
  dec?: number;
  magnitude?: number;
  apparentSize?: string;
  distance?: string;
  description?: string;
  source?: string;
  sourceReference?: string;
  lastUpdated?: string;
};

export type Job = {
  id: number;
  type: string;
  status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED";
  errorMessage?: string;
  createdAt?: string;
  startedAt?: string;
  finishedAt?: string;
  resultStorageKey?: string;
  frameId?: number;
  sessionId?: number;
  targetId?: number;
};

export type ProcessedAsset = {
  id: number;
  title?: string;
  software?: string;
  versionLabel?: string;
  notes?: string;
  createdAt?: string;
  storageKey?: string;
  previewStorageKey?: string;
  session?: { id?: number };
  target?: { id?: number; name?: string };
};

export type WorkflowStatus = {
  steps: { label: string; done: boolean }[];
  completedSteps: number;
  totalSteps: number;
  label: string;
  status?: string;
  manual?: boolean;
};

export type TargetDetailData = {
  target: Target;
  stats: { sessions: number; frames: number; integrationTime: number; results: number };
  latestResult?: ProcessedAsset;
  enrichment?: TargetEnrichment;
  timeline: { sessionId: number; startTime?: string; endTime?: string; integrationTime?: number; frameCount: number; hasResult: boolean }[];
  sessions: Session[];
  frames: Frame[];
  results: ProcessedAsset[];
};

export type StorageUsage = {
  usedBytes: number;
  freeBytes?: number | null;
  totalBytes?: number | null;
  buckets?: { bucket: string; objects: number; usedBytes: number }[];
};

export type Confirm = {
  title: string;
  description: string;
  action: () => Promise<void> | void;
} | null;

export type UiSettings = {
  pageSize: number;
  defaultFrameView: "grid" | "list";
  defaultResultsSort: "object" | "date-desc" | "date-asc";
  compactCards: boolean;
  showResultUploadPanel: boolean;
  previewBatchSize: number;
  refreshSeconds: number;
  integrationTimeFormat: "auto" | "seconds" | "minutes" | "hours" | "days" | "hms";
};

export type ApiClient = (path: string, init?: RequestInit) => Promise<Response>;

export const defaultUiSettings: UiSettings = {
  pageSize: 30,
  defaultFrameView: "grid",
  defaultResultsSort: "date-desc",
  compactCards: false,
  showResultUploadPanel: true,
  previewBatchSize: 12,
  refreshSeconds: 30,
  integrationTimeFormat: "auto",
};
