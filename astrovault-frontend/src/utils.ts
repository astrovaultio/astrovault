import type { ApiClient, Frame, ProcessedAsset, Session, UiSettings } from "./types";

const apiBase = import.meta.env.VITE_API_BASE ?? "http://localhost:8080";

export const fmtDate = (v?: string) => (v ? new Date(v).toLocaleString() : "Not available");

export const fmtShortDate = (v?: string) =>
  v
    ? new Intl.DateTimeFormat(undefined, {
        day: "2-digit",
        month: "short",
        year: "numeric",
      }).format(new Date(v))
    : "Unknown night";

export const fmtNumber = (v: number, maximumFractionDigits = 1) => new Intl.NumberFormat(undefined, { maximumFractionDigits }).format(v);

export const fmtBytes = (v?: number | null) => {
  if (v == null) return "Unknown";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = Math.max(0, v);
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${fmtNumber(value, unit === 0 ? 0 : 1)} ${units[unit]}`;
};

export const fmtSeconds = (v?: number, format: UiSettings["integrationTimeFormat"] = "auto") => {
  if (v == null) return "Not available";
  const seconds = Math.max(0, v);
  if (format === "seconds") return `${fmtNumber(seconds, 0)}s`;
  if (format === "minutes") return `${fmtNumber(seconds / 60, 1)} min`;
  if (format === "hours") return `${fmtNumber(seconds / 3600, 1)} h`;
  if (format === "days") return `${fmtNumber(seconds / 86400, 2)} d`;
  if (format === "hms") {
    const total = Math.round(seconds);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return h > 0 ? `${h}h ${m}m ${s}s` : m > 0 ? `${m}m ${s}s` : `${s}s`;
  }
  if (seconds >= 172800) return `${fmtNumber(seconds / 86400, 1)} d`;
  if (seconds >= 7200) return `${fmtNumber(seconds / 3600, 1)} h`;
  if (seconds >= 120) return `${fmtNumber(seconds / 60, 1)} min`;
  return `${fmtNumber(seconds, 0)}s`;
};

export const na = (v?: string | number | null) => v == null || String(v).trim() === "" ? "Not available" : String(v);

export const normalizeTargetName = (name?: string) => {
  const value = (name ?? "").trim();
  if (!value || value === "-" || value.toUpperCase() === "UNKNOWN") return "Unassigned";
  const messier = value.match(/^m\s*(\d+)$/i);
  if (messier) return `M${messier[1]}`;
  return value.replace(/\b\w/g, (c) => c.toUpperCase());
};

export const sessionLabel = (s?: Session) =>
  `${normalizeTargetName(s?.target?.name)} · ${fmtShortDate(s?.startTime)}`;

export const pageSlice = <T,>(arr: T[], page: number, pageSize: number) =>
  arr.slice((page - 1) * pageSize, page * pageSize);

export const totalPages = (count: number, pageSize: number) =>
  Math.max(1, Math.ceil(count / pageSize));

export const normalizedValue = (value: unknown): string | null => {
  if (value == null) return null;
  const s = String(value).trim();
  if (!s) return null;
  const u = s.toUpperCase();
  if (u === "N/A" || u === "UNKNOWN" || u === "NULL" || u === "NONE" || u === "-") return null;
  return s;
};

export const metadataValue = (
  metadata: Record<string, unknown>,
  keys: string[],
  fallback?: unknown,
): string => {
  const header =
    (metadata.rawHeader as Record<string, unknown> | undefined) ??
    (metadata.header as Record<string, unknown> | undefined) ??
    {};
  for (const key of keys) {
    const value = normalizedValue(header[key]);
    if (value) return value;
  }
  const f = normalizedValue(fallback);
  return f ?? "-";
};

export const frameMetadata = (frame: Frame): Record<string, unknown> => {
  try {
    return frame.metadata ? JSON.parse(frame.metadata) : {};
  } catch {
    return {};
  }
};

export const frameField = (frame: Frame, keys: string[], fallback?: unknown) =>
  metadataValue(frameMetadata(frame), keys, fallback);

export const numericFrameField = (frame: Frame, keys: string[], fallback?: number) => {
  const value = frameField(frame, keys, fallback);
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

export const sessionDisplayName = (session: Session) =>
  `${normalizeTargetName(session.target?.name)} • ${fmtShortDate(session.startTime)}`;

export const sessionDuration = (session: Session) => {
  if (!session.startTime || !session.endTime) return "Open session";
  const seconds = Math.max(0, (new Date(session.endTime).getTime() - new Date(session.startTime).getTime()) / 1000);
  return fmtSeconds(seconds);
};

export const frameGroupOrder = ["LIGHT", "DARK", "FLAT", "DARK_FLAT", "BIAS"];

export const frameTypeCounts = (frames: Frame[]) =>
  frames.reduce<Record<string, number>>((acc, frame) => {
    const type = frame.frameType || "UNKNOWN";
    acc[type] = (acc[type] ?? 0) + 1;
    return acc;
  }, {});

export const totalExposure = (frames: Frame[]) =>
  frames.reduce((sum, frame) => sum + numericFrameField(frame, ["EXPTIME", "EXPOSURE"], frame.exposureSeconds), 0);

export const firstAvailable = (frames: Frame[], getter: (frame: Frame) => string) => {
  for (const frame of frames) {
    const value = getter(frame);
    if (value && value !== "-") return value;
  }
  return "-";
};

export const sessionCamera = (frames: Frame[]) => firstAvailable(frames, (f) => frameField(f, ["INSTRUME", "CAMERA"], f.cameraName));
export const sessionFilter = (frames: Frame[]) => firstAvailable(frames, (f) => frameField(f, ["FILTER"]));
export const frameObjectName = (frame: Frame, session?: Session) => frameField(frame, ["OBJECT", "OBJNAME"], session?.target?.name ?? "Unknown Object");
export const frameExposureLabel = (frame: Frame) => {
  const seconds = numericFrameField(frame, ["EXPTIME", "EXPOSURE"], frame.exposureSeconds);
  return seconds ? `${seconds}s` : "-";
};

export const uniqueOptions = (values: string[]) =>
  Array.from(new Set(values.filter((v) => v && v !== "-"))).sort().map((value) => ({ value, label: value }));

export async function downloadProcessedAsset(api: ApiClient, asset: ProcessedAsset) {
  const res = await api(`/api/processed-assets/${asset.id}/download`);
  await downloadResponseBlob(res, asset.title || `processed-asset-${asset.id}`);
}

export async function downloadExportZip(api: ApiClient, jobId: number) {
  const downloadWindow = window.open("about:blank", "astrovault-download");
  await api("/api/auth/session-cookie", { method: "POST" });
  const href = new URL(`/api/exports/${jobId}/download`, apiBase).toString();
  if (downloadWindow) {
    downloadWindow.location.href = href;
    return;
  }
  const a = document.createElement("a");
  a.href = href;
  a.target = "_blank";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  window.setTimeout(() => a.remove(), 10_000);
}

export async function downloadResponseBlob(res: Response, filename: string) {
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
