import "@mantine/core/styles.css";
import "@mantine/notifications/styles.css";
import React, { FormEvent, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  BrowserRouter,
  Link,
  NavLink as RouterNavLink,
  Route,
  Routes,
  useNavigate,
  useParams,
} from "react-router-dom";
import {
  ActionIcon,
  Alert,
  AppShell,
  Badge,
  Button,
  Card,
  Checkbox,
  FileInput,
  Grid,
  Group,
  Image,
  Loader,
  MantineProvider,
  Menu,
  Modal,
  MultiSelect,
  NavLink,
  Notification,
  Paper,
  Select,
  SimpleGrid,
  Skeleton,
  Stack,
  Switch,
  Table,
  Tabs,
  Text,
  TextInput,
  Textarea,
  ThemeIcon,
  Title,
  Tooltip,
} from "@mantine/core";
import { Notifications, notifications } from "@mantine/notifications";
import {
  IconAlertCircle,
  IconArrowLeft,
  IconBriefcase,
  IconCamera,
  IconChartBar,
  IconDotsVertical,
  IconFilter,
  IconFolders,
  IconLayoutGrid,
  IconMoonStars,
  IconPhoto,
  IconRocket,
  IconSettings,
  IconTable,
  IconTargetArrow,
} from "@tabler/icons-react";
import { getFramePreviewCache, rememberFramePreview, useApi, useAutoRefresh, useLazyFrameImage, useLazyProcessedAssetImage } from "./hooks";
import type { Confirm, Frame, Job, ProcessedAsset, Session, StorageUsage, Target, TargetDetailData, UiSettings, WorkflowStatus } from "./types";
import { defaultUiSettings } from "./types";
import { downloadExportZip, downloadProcessedAsset, fmtBytes, fmtDate, fmtSeconds, fmtShortDate, frameExposureLabel, frameField, frameGroupOrder, frameMetadata, frameObjectName, frameTypeCounts, metadataValue, na, normalizeTargetName, pageSlice, sessionCamera, sessionDisplayName, sessionDuration, sessionFilter, sessionLabel, totalExposure, totalPages, uniqueOptions } from "./utils";
import "./styles.css";

const apiBase = import.meta.env.VITE_API_BASE ?? "http://localhost:8080";

function ProcessedAssetModal({
  api,
  asset,
  onClose,
  onDownload,
}: {
  api: ReturnType<typeof useApi>;
  asset: ProcessedAsset | null;
  onClose: () => void;
  onDownload: (asset: ProcessedAsset) => void;
}) {
  return (
    <Modal opened={!!asset} onClose={onClose} title={asset?.title ?? "Processed result"} size="90%" centered>
      {asset ? (
        <Stack gap="md">
          <LazyProcessedAssetImage api={api} asset={asset} label="Preview not available" />
          <Group justify="space-between">
            <Text c="dimmed" size="sm">{asset.target?.name ?? "Unknown target"} · {fmtShortDate(asset.createdAt)}</Text>
            <Button onClick={() => onDownload(asset)}>Download file</Button>
          </Group>
        </Stack>
      ) : null}
    </Modal>
  );
}

function ListFooter({
  count,
  page,
  pages,
  onPrev,
  onNext,
}: {
  count: number;
  page: number;
  pages: number;
  onPrev: () => void;
  onNext: () => void;
}) {
  return (
    <Group justify="space-between" mt="md">
      <Text c="dimmed" size="sm">
        {count} items
      </Text>
      <Group>
        <Button
          size="xs"
          variant="default"
          disabled={page <= 1}
          onClick={onPrev}
        >
          Previous
        </Button>
        <Text size="sm">
          {page} / {pages}
        </Text>
        <Button
          size="xs"
          variant="default"
          disabled={page >= pages}
          onClick={onNext}
        >
          Next
        </Button>
      </Group>
    </Group>
  );
}

function TableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div>
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} h={28} mt={i === 0 ? 0 : 10} radius="sm" />
      ))}
    </div>
  );
}

function PageHeader({ title, subtitle, right }: { title: string; subtitle: string; right?: React.ReactNode }) {
  return <Paper className="page-header panel" p="xl" radius="lg"><Group justify="space-between" align="flex-start" wrap="wrap" gap="md"><div><Title order={2}>{title}</Title><Text c="dimmed" mt={4}>{subtitle}</Text></div>{right}</Group></Paper>;
}

function BrandMark({ size = 40 }: { size?: number }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className="brand-mark" style={{ width: size, height: size }}>
      {!failed ? <img src="/logo.png" alt="AstroVault logo" onError={() => setFailed(true)} /> : <IconMoonStars size={Math.round(size * 0.58)} />}
    </div>
  );
}

function EmptyState({ title, message }: { title: string; message: string }) {
  return <Paper className="empty-state" p="xl" radius="lg"><Stack align="center" gap="xs"><IconMoonStars size={28} color="#74c0fc" /><Text fw={700}>{title}</Text><Text c="dimmed" size="sm" ta="center">{message}</Text></Stack></Paper>;
}

function StatCard({ label, value, icon }: { label: string; value: React.ReactNode; icon: React.ReactNode }) {
  return <Card className="panel stat-card" radius="lg" p="xl"><Group justify="space-between"><div><Text c="dimmed" size="sm">{label}</Text><Title order={2} mt={6}>{value}</Title></div><Paper className="icon-tile" p="sm" radius="md">{icon}</Paper></Group></Card>;
}

function PreviewPlaceholder({ label = "No preview" }: { label?: string }) {
  return <div className="preview-placeholder"><IconPhoto size={24} /><Text size="sm">{label}</Text></div>;
}

function LazyProcessedAssetImage({
  api,
  asset,
  className,
  height,
  label = "No preview",
}: {
  api: ReturnType<typeof useApi>;
  asset: ProcessedAsset;
  className?: string;
  height?: number;
  label?: string;
}) {
  const { ref, url, hasImage, failed } = useLazyProcessedAssetImage(api, asset);
  const placeholder = failed ? "Preview not available" : hasImage ? "Loading preview" : label;
  return <div ref={ref}>{url ? <Image src={url} h={height} className={className} fit="contain" alt={asset.title ?? "Processed result"} /> : <PreviewPlaceholder label={placeholder} />}</div>;
}

function FrameGalleryCard({
  api,
  frame,
  session,
  settings,
  onZoom,
}: {
  api: ReturnType<typeof useApi>;
  frame: Frame;
  session?: Session;
  settings: UiSettings;
  onZoom: (frame: Frame) => void;
}) {
  const { ref, url, hasImage, failed } = useLazyFrameImage(api, frame, "thumbnail");
  const objectName = normalizeTargetName(frameObjectName(frame, session));
  const isCalibration = frame.frameType !== "LIGHT";
  return (
    <Card key={frame.id} withBorder radius="lg" p={0} className={`frame-card astro-frame-card compact-frame-card ${isCalibration ? "calibration-frame-card" : ""}`}>
      <div ref={ref} onClick={() => onZoom(frame)} className="frame-image-hitbox">
        {url ? <Image src={url} className="frame-preview-image" alt={frame.originalFilename} /> : <PreviewPlaceholder label={failed ? "Preview not available" : hasImage ? "Loading" : "No preview"} />}
        <div className="frame-overlay">
          <Group justify="space-between" gap="xs" wrap="nowrap">
            <div className="frame-overlay-text">
              <Text component={Link} to={`/frames/${frame.id}`} className="table-link" fw={900} truncate>{objectName}</Text>
              <Text c="dimmed" size="xs" truncate>{frame.originalFilename}</Text>
            </div>
            <FrameTypeBadge type={frame.frameType} />
          </Group>
          <Group gap={5} mt={6}>
            <Badge size="xs" variant="light">{frameExposureLabel(frame)}</Badge>
            <Badge size="xs" variant="light">G {frameField(frame, ["GAIN"])}</Badge>
            <StatusBadge status={frame.processingStatus} />
          </Group>
        </div>
      </div>
    </Card>
  );
}

function SessionFrameCard({ api, frame, onZoom }: { api: ReturnType<typeof useApi>; frame: Frame; onZoom: (frame: Frame) => void }) {
  const { ref, url, hasImage, failed } = useLazyFrameImage(api, frame, "thumbnail");
  return (
    <Card key={frame.id} className="frame-card compact-frame-card" radius="lg" p={0} withBorder>
      <div ref={ref} className="frame-image-hitbox" onClick={() => onZoom(frame)}>
        {url ? <Image src={url} className="frame-preview-image" alt={frame.originalFilename} /> : <PreviewPlaceholder label={failed ? "Preview not available" : hasImage ? "Loading" : "No preview"} />}
        <div className="frame-overlay">
          <Text component={Link} to={`/frames/${frame.id}`} className="table-link" fw={800} truncate>{frame.originalFilename}</Text>
          <Group gap={5} mt={6}><Badge size="xs" variant="light">{frameExposureLabel(frame)}</Badge><Badge size="xs" variant="light">G {frameField(frame, ["GAIN"])}</Badge><StatusBadge status={frame.processingStatus} /></Group>
        </div>
      </div>
    </Card>
  );
}

function SelectedFramePreview({ api, frame }: { api: ReturnType<typeof useApi>; frame: Frame }) {
  const { ref, url, hasImage, failed } = useLazyFrameImage(api, frame, "preview", true);
  return (
    <Stack gap="md">
      <div ref={ref}>{url ? <Image src={url} fit="contain" mah="72vh" radius="md" alt={frame.originalFilename} /> : <PreviewPlaceholder label={failed ? "Preview not available" : hasImage ? "Loading preview" : "No preview"} />}</div>
      <Group justify="space-between"><Text c="dimmed" size="sm">{frame.originalFilename}</Text><Button component={Link} to={`/frames/${frame.id}`}>Open Frame Detail</Button></Group>
    </Stack>
  );
}

function FrameTypeBadge({ type }: { type?: string }) {
  return <Badge size="xs" variant="light">{type ?? "Unknown"}</Badge>;
}

function StatusBadge({ status }: { status?: string }) {
  const color = status === "FAILED" ? "red" : status === "COMPLETED" ? "green" : status === "RUNNING" ? "blue" : status === "CANCELLED" ? "gray" : "yellow";
  return <Badge color={color} variant="light">{status ?? "Not recorded"}</Badge>;
}

const enrichmentFact = (value?: string | number | null) => value === undefined || value === null || value === "" ? "Not available" : String(value);

function EnrichmentDescriptionDisclosure({ description, source }: { description?: string | null; source?: string | null }) {
  const [opened, setOpened] = useState(false);
  const available = !!description?.trim();
  const sourceLabel = source?.includes("Wikipedia") ? "Wikipedia summary" : "Catalog description";
  return (
    <Card p="sm" radius="md" withBorder mt="sm">
      <Group justify="space-between" align="center">
        <div><Text fw={800} size="sm">Object description</Text><Text c="dimmed" size="xs">{available ? sourceLabel : "Not available"}</Text></div>
        <Button size="xs" variant="light" disabled={!available} onClick={() => setOpened((value) => !value)}>{opened ? "Hide" : "Show"}</Button>
      </Group>
      {opened ? (
        <Text mt="sm" size="sm" c="dimmed">{description}</Text>
      ) : null}
    </Card>
  );
}

const sessionWorkflowSteps = (frames: Frame[], results: ProcessedAsset[]) => {
  const counts = frameTypeCounts(frames);
  const hasLights = (counts.LIGHT ?? 0) > 0;
  const hasCalibration = (counts.DARK ?? 0) + (counts.FLAT ?? 0) + (counts.BIAS ?? 0) + (counts.DARK_FLAT ?? 0) > 0;
  const hasStacked = results.some((r) => `${r.title ?? ""} ${r.software ?? ""}`.toLowerCase().includes("stack"));
  const hasProcessed = results.length > 0;
  const hasPublished = results.some((r) => `${r.versionLabel ?? ""} ${r.notes ?? ""}`.toLowerCase().includes("published"));
  return [
    { label: "Capture", done: hasLights || frames.length > 0 },
    { label: "Calibration", done: hasCalibration },
    { label: "Stacked", done: hasStacked || hasProcessed },
    { label: "Processed", done: hasProcessed },
    { label: "Published", done: hasPublished },
  ];
};

const workflowSummary = (frames: Frame[], results: ProcessedAsset[]) => {
  const steps = sessionWorkflowSteps(frames, results);
  const done = steps.filter((s) => s.done).length;
  return { steps, done, label: `${done}/${steps.length}` };
};

const workflowManualOptions = [
  { value: "IN_PROGRESS", label: "Started" },
  { value: "CAPTURE", label: "Capture" },
  { value: "CALIBRATION", label: "Calibration" },
  { value: "STACKED", label: "Stacked" },
  { value: "PROCESSED", label: "Processed" },
  { value: "PUBLISHED", label: "Published" },
];

function Login({ onToken }: { onToken: (v: string) => void }) {
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("admin");
  const [error, setError] = useState("");
  const nav = useNavigate();
  return (
    <Grid justify="center" mt={110}>
      <Grid.Col span={{ base: 11, sm: 6, md: 4 }}>
        <Card className="panel" radius="lg" shadow="lg">
          <Title order={3} mb="md">
            AstroVault Login
          </Title>
          <TextInput
            label="Username"
            value={username}
            onChange={(e) => setUsername(e.currentTarget.value)}
          />
          <TextInput
            mt="sm"
            label="Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.currentTarget.value)}
          />
          <Button
            mt="md"
            fullWidth
            onClick={async () => {
              setError("");
              try {
                const r = await fetch(`${apiBase}/api/auth/login`, {
                  method: "POST",
                  credentials: "include",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ username, password }),
                });
                if (!r.ok) throw new Error("Login failed");
                onToken((await r.json()).token);
                nav("/dashboard");
              } catch (e: any) {
                setError(e.message);
              }
            }}
          >
            Sign in
          </Button>
          {error && (
            <Notification
              mt="md"
              color="red"
              icon={<IconAlertCircle size={16} />}
            >
              {error}
            </Notification>
          )}
        </Card>
      </Grid.Col>
    </Grid>
  );
}

function Dashboard({ api, settings }: { api: ReturnType<typeof useApi>; settings: UiSettings }) {
  const [d, setD] = useState<any>(null);
  const [storage, setStorage] = useState<StorageUsage | null>(null);
  const [selectedResult, setSelectedResult] = useState<ProcessedAsset | null>(null);
  const [selectedFrame, setSelectedFrame] = useState<Frame | null>(null);
  const loadDashboard = async () => {
    const [dashboard, storageUsage] = await Promise.all([
      api("/api/dashboard").then((r) => r.json()),
      api("/api/storage/usage").then((r) => r.json()).catch(() => null as StorageUsage | null),
    ]);
    setD(dashboard);
    setStorage(storageUsage);
  };
  useEffect(() => {
    void loadDashboard();
  }, [api]);
  useAutoRefresh(() => { void loadDashboard(); }, settings.refreshSeconds);
  const recentResults: ProcessedAsset[] = d?.recentProcessedAssets ?? d?.recentResults ?? [];
  const latestProcessed = recentResults.slice().sort((a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime()).slice(0, 6);
  if (!d)
    return (
      <Stack gap="lg"><Skeleton h={112} radius="lg" /><SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }}>{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} h={122} radius="lg" />)}</SimpleGrid></Stack>
    );
  const recentFrames: Frame[] = d.recentImports ?? [];
  const recentSessions: Session[] = d.recentSessions ?? [];
  const activeJobs: Job[] = d.activeJobs ?? [];
  const pendingProcessing = activeJobs.filter((j) => j.status === "PENDING" || j.status === "RUNNING");
  return (
    <Stack gap="lg">
      <PageHeader title="Dashboard" subtitle="What you captured, what is processing, and what needs work next." right={<Group><Button component={Link} to="/targets" variant="light">Open targets</Button><Button component={Link} to="/frames">Browse frames</Button></Group>} />
      <div className="desktop-grid stat-grid-5">
        <StatCard label="Captured Sessions" value={d.sessionCount ?? recentSessions.length} icon={<IconFolders size={20} />} />
        <StatCard label="Captured Frames" value={d.frameCount ?? recentFrames.length} icon={<IconCamera size={20} />} />
        <StatCard label="Integration" value={fmtSeconds(d.integrationTime, settings.integrationTimeFormat)} icon={<IconChartBar size={20} />} />
        <StatCard label="Results" value={d.resultCount ?? d.processedAssetCount ?? recentResults.length} icon={<IconPhoto size={20} />} />
        <StatCard label="Active Jobs" value={pendingProcessing.length} icon={<IconRocket size={20} />} />
        <StatCard label="Storage Used" value={fmtBytes(storage?.usedBytes)} icon={<IconFolders size={20} />} />
      </div>
      <div className="desktop-grid dashboard-two-column">
        <Card className="panel" radius="lg" p="xl">
          <Group justify="space-between"><Title order={4}>Recent Imaging Sessions</Title><Button component={Link} to="/sessions" size="xs" variant="subtle">View all</Button></Group>
          <Stack gap="sm" mt="md">
            {recentSessions.length ? recentSessions.slice(0, 8).map((s) => <Group key={s.id} className="compact-row" justify="space-between"><div><Text component={Link} to={`/sessions/${s.id}`} className="table-link" fw={600} size="sm">{sessionDisplayName(s)}</Text><Text size="xs" c="dimmed">{sessionDuration(s)}</Text></div><Badge variant="light">{fmtSeconds(s.totalIntegrationTime, settings.integrationTimeFormat)}</Badge></Group>) : <EmptyState title="No sessions found" message="Import frames from ASIAIR to create your first observing session." />}
          </Stack>
        </Card>
          <Card className="panel" radius="lg" p="xl">
            <Group justify="space-between"><Title order={4}>Storage</Title><Badge variant="light">{storage?.freeBytes != null ? `${fmtBytes(storage.freeBytes)} free` : "Free unknown"}</Badge></Group>
            <Stack gap="sm" mt="md">
              <Group className="compact-row" justify="space-between"><Text c="dimmed">Used</Text><Text fw={800}>{fmtBytes(storage?.usedBytes)}</Text></Group>
              <Group className="compact-row" justify="space-between"><Text c="dimmed">Total</Text><Text fw={800}>{fmtBytes(storage?.totalBytes)}</Text></Group>
              {storage?.buckets?.map((b) => <Group key={b.bucket} className="compact-row" justify="space-between"><div><Text fw={700}>{b.bucket}</Text><Text c="dimmed" size="xs">{b.objects} objects</Text></div><Badge variant="light">{fmtBytes(b.usedBytes)}</Badge></Group>)}
            </Stack>
          </Card>
      </div>
      <Card className="panel" radius="lg" p="xl"><Group justify="space-between"><Title order={4}>Latest Imported Frames</Title><Button component={Link} to="/frames" size="xs" variant="subtle">View all</Button></Group>{recentFrames.length ? <div className="dashboard-frame-grid" style={{ marginTop: 16 }}>{recentFrames.slice(0, 10).map((f) => <FrameGalleryCard key={f.id} api={api} frame={f} settings={settings} onZoom={setSelectedFrame} />)}</div> : <EmptyState title="No recent imports" message="Import frames from ASIAIR to fill the capture gallery." />}</Card>
      <Card className="panel" radius="lg" p="xl"><Group justify="space-between"><Title order={4}>Latest Results</Title><Button component={Link} to="/results" size="xs" variant="subtle">View all</Button></Group>{latestProcessed.length ? <div className="desktop-grid dashboard-results-grid" style={{ marginTop: 16 }}>{latestProcessed.map((a) => <Card key={a.id} className="result-tile result-gallery-card" radius="lg" p={0} withBorder onClick={() => setSelectedResult(a)}><LazyProcessedAssetImage api={api} asset={a} height={190} label="No preview" /><Stack gap={4} p="sm"><Text fw={800} size="sm" truncate>{a.title || "Untitled result"}</Text><Text size="xs" c="dimmed" truncate>{a.target?.name ?? "Unknown target"}</Text><Badge size="xs" variant="light">{fmtShortDate(a.createdAt)}</Badge></Stack></Card>)}</div> : <EmptyState title="No processed result yet" message="Upload your PixInsight result after stacking a session." />}</Card>
      <ProcessedAssetModal api={api} asset={selectedResult} onClose={() => setSelectedResult(null)} onDownload={(asset) => void downloadProcessedAsset(api, asset)} />
      <Modal opened={!!selectedFrame} onClose={() => setSelectedFrame(null)} title={selectedFrame?.originalFilename ?? "Frame Preview"} size="90%">
        {selectedFrame ? <SelectedFramePreview api={api} frame={selectedFrame} /> : null}
      </Modal>
    </Stack>
  );
}

function FramesPage({
  api,
  settings,
}: {
  api: ReturnType<typeof useApi>;
  settings: UiSettings;
}) {
  const [frames, setFrames] = useState<Frame[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [viewMode, setViewMode] = useState<"list" | "grid">(
    settings.defaultFrameView,
  );
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const [targetFilter, setTargetFilter] = useState<string | null>(null);
  const [sessionFilter, setSessionFilter] = useState<string | null>(null);
  const [cameraFilter, setCameraFilter] = useState<string | null>(null);
  const [filterFilter, setFilterFilter] = useState<string | null>(null);
  const [selectedFrame, setSelectedFrame] = useState<Frame | null>(null);
  const [page, setPage] = useState(1);
  useEffect(() => {
    setLoading(true);
    void Promise.all([
      api("/api/frames").then((r) => r.json()).then(setFrames),
      api("/api/sessions").then((r) => r.json()).then(setSessions),
    ]).finally(() => setLoading(false));
  }, [api]);
  useAutoRefresh(() => {
    void api("/api/frames")
      .then((r) => r.json())
      .then(setFrames);
  }, settings.refreshSeconds);
  const sessionById = Object.fromEntries(sessions.map((s) => [s.id, s]));
  const filtered = frames.filter((f) => {
    const s = f.session?.id ? sessionById[f.session.id] : undefined;
    const objectName = frameObjectName(f, s);
    const camera = frameField(f, ["INSTRUME", "CAMERA"], f.cameraName);
    const filter = frameField(f, ["FILTER"]);
    return `${f.originalFilename} ${f.frameType} ${objectName} ${camera} ${filter}`.toLowerCase().includes(q.toLowerCase()) &&
      (!typeFilter || f.frameType === typeFilter) &&
      (!targetFilter || objectName === targetFilter) &&
      (!sessionFilter || String(f.session?.id ?? "") === sessionFilter) &&
      (!cameraFilter || camera === cameraFilter) &&
      (!filterFilter || filter === filterFilter);
  });
  const framePageSize = Math.min(settings.pageSize, 30);
  const pages = totalPages(filtered.length, framePageSize);
  const visible = pageSlice(filtered, page, framePageSize);
  useEffect(() => {
    if (page > pages) setPage(pages);
  }, [page, pages]);

  return (
    <Stack gap="lg">
      <PageHeader title="Frame Gallery" subtitle="Browse raw captures as an astrophotography image library, not database rows." right={
          <Group>
            <TextInput
              leftSection={<IconFilter size={14} />}
              placeholder="Search frames"
              value={q}
              onChange={(e) => {
                setQ(e.currentTarget.value);
                setPage(1);
              }}
            />
            <ActionIcon
              variant={viewMode === "grid" ? "filled" : "light"}
              color="cyan"
              onClick={() => setViewMode("grid")}
            >
              <IconLayoutGrid size={16} />
            </ActionIcon>
            <ActionIcon
              variant={viewMode === "list" ? "filled" : "light"}
              color="cyan"
              onClick={() => setViewMode("list")}
            >
              <IconTable size={16} />
            </ActionIcon>
          </Group>
        }
      />
      <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} spacing="lg">
        <StatCard label="Frames" value={frames.length} icon={<IconCamera size={20} />} />
        <StatCard label="Light" value={frames.filter((f) => f.frameType === "LIGHT").length} icon={<IconMoonStars size={20} />} />
        <StatCard label="Calibrations" value={frames.filter((f) => f.frameType !== "LIGHT").length} icon={<IconChartBar size={20} />} />
        <StatCard label="Shown" value={filtered.length} icon={<IconFolders size={20} />} />
      </SimpleGrid>
      <div className="desktop-grid frames-workspace-grid">
        <div>
          <Card className="panel frame-filter-sidebar" radius="lg" p="xl">
            <Title order={4}>Filters</Title>
            <Text c="dimmed" size="sm" mt={4}>Narrow by acquisition context.</Text>
            <Stack mt="lg" gap="sm">
              <Select label="Frame Type" data={uniqueOptions(frames.map((f) => f.frameType))} value={typeFilter} onChange={(v) => { setTypeFilter(v); setPage(1); }} clearable />
              <Select label="Target" data={uniqueOptions(frames.map((f) => frameObjectName(f, f.session?.id ? sessionById[f.session.id] : undefined)))} value={targetFilter} onChange={(v) => { setTargetFilter(v); setPage(1); }} clearable />
              <Select label="Session" data={sessions.map((s) => ({ value: String(s.id), label: sessionDisplayName(s) }))} value={sessionFilter} onChange={(v) => { setSessionFilter(v); setPage(1); }} clearable />
              <Select label="Camera" data={uniqueOptions(frames.map((f) => frameField(f, ["INSTRUME", "CAMERA"], f.cameraName)))} value={cameraFilter} onChange={(v) => { setCameraFilter(v); setPage(1); }} clearable />
              <Select label="Filter" data={uniqueOptions(frames.map((f) => frameField(f, ["FILTER"])))} value={filterFilter} onChange={(v) => { setFilterFilter(v); setPage(1); }} clearable />
              <Button variant="light" onClick={() => { setTypeFilter(null); setTargetFilter(null); setSessionFilter(null); setCameraFilter(null); setFilterFilter(null); setQ(""); setPage(1); }}>Clear Filters</Button>
            </Stack>
          </Card>
        </div>
        <div>
          <Card className="panel" radius="lg" p="xl">
            <Group justify="space-between" mb="lg">
              <div>
                <Title order={4}>Frame Gallery</Title>
                <Text c="dimmed" size="sm">Preview thumbnails with object, exposure, gain, temperature, and type.</Text>
              </div>
              <Badge variant="light">{filtered.length} shown</Badge>
            </Group>
            {loading ? (
              <TableSkeleton rows={7} />
            ) : filtered.length === 0 ? (
              <EmptyState title="No frames found" message="No captures match the current gallery filters." />
            ) : viewMode === "list" ? (
              <Table striped highlightOnHover>
                <Table.Thead><Table.Tr><Table.Th>Preview</Table.Th><Table.Th>Object</Table.Th><Table.Th>Acquisition</Table.Th><Table.Th>Status</Table.Th></Table.Tr></Table.Thead>
                <Table.Tbody>{visible.map((f) => {
                  const s = f.session?.id ? sessionById[f.session.id] : undefined;
                  return <Table.Tr key={f.id}><Table.Td><Text c="dimmed" size="sm">{f.thumbnailStorageKey ? "Available" : "No preview"}</Text></Table.Td><Table.Td><Text component={Link} className="table-link" to={`/frames/${f.id}`} fw={800}>{normalizeTargetName(frameObjectName(f, s))}</Text><Text c="dimmed" size="xs" truncate>{f.originalFilename}</Text></Table.Td><Table.Td><Group gap={6}><FrameTypeBadge type={f.frameType} /><Badge size="xs" variant="light">{frameExposureLabel(f)}</Badge><Badge size="xs" variant="light">Gain {frameField(f, ["GAIN"])}</Badge><Badge size="xs" variant="light">{frameField(f, ["CCD-TEMP", "SENSOR-TEMP"])}°C</Badge></Group></Table.Td><Table.Td><StatusBadge status={f.processingStatus} /></Table.Td></Table.Tr>;
                })}</Table.Tbody>
              </Table>
            ) : (
              <div className="frames-gallery-grid">
                {visible.map((f) => {
                  const s = f.session?.id ? sessionById[f.session.id] : undefined;
                  return <FrameGalleryCard key={f.id} api={api} frame={f} session={s} settings={settings} onZoom={setSelectedFrame} />;
                })}
              </div>
            )}
            <ListFooter count={filtered.length} page={page} pages={pages} onPrev={() => setPage((p) => p - 1)} onNext={() => setPage((p) => p + 1)} />
          </Card>
        </div>
      </div>
      <Modal opened={!!selectedFrame} onClose={() => setSelectedFrame(null)} title={selectedFrame ? frameObjectName(selectedFrame, selectedFrame.session?.id ? sessionById[selectedFrame.session.id] : undefined) : "Frame Preview"} size="90%">
        {selectedFrame ? <SelectedFramePreview api={api} frame={selectedFrame} /> : null}
      </Modal>
    </Stack>
  );
}

function FrameDetail({
  api,
  askConfirm,
}: {
  api: ReturnType<typeof useApi>;
  askConfirm: (c: Confirm) => void;
}) {
  const { id } = useParams();
  const nav = useNavigate();
  const [f, setF] = useState<Frame | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [previewUrl, setPreviewUrl] = useState(() => id ? getFramePreviewCache(Number(id)) : "");
  const [showRaw, setShowRaw] = useState(false);
  const load = async () => setF(await (await api(`/api/frames/${id}`)).json());
  const loadJobs = async () => setJobs(await (await api(`/api/frames/${id}/jobs`)).json());
  useEffect(() => {
    void load();
    void loadJobs();
    api("/api/sessions")
      .then((r) => r.json())
      .then(setSessions);
  }, [api, id]);
  useEffect(() => {
    if (!f) return;
    const cached = getFramePreviewCache(f.id);
    if (cached) {
      setPreviewUrl(cached);
      return;
    }
    if (!f.previewStorageKey) {
      setPreviewUrl("");
      return;
    }
    api(`/api/frames/${f.id}/preview`)
      .then((r) => r.blob())
      .then((b) => {
        const url = URL.createObjectURL(b);
        rememberFramePreview(f.id, url);
        setPreviewUrl(url);
      })
      .catch(() => setPreviewUrl(""));
  }, [api, f?.id]);
  if (!f) return <Text c="dimmed">Loading frame...</Text>;
  const currentSession = sessions.find((s) => s.id === f.session?.id);
  const md = frameMetadata(f);
  const raw =
    (md.rawHeader as Record<string, unknown> | undefined) ??
    (md.header as Record<string, unknown> | undefined) ??
    {};
  const acquisitionRows = [["Exposure", frameExposureLabel(f)], ["Gain", metadataValue(md, ["GAIN"])], ["Temperature", `${metadataValue(md, ["CCD-TEMP", "SENSOR-TEMP"])}°C`], ["Date Obs", metadataValue(md, ["DATE-OBS"], f.observedAt)], ["Frame Type", f.frameType ?? metadataValue(md, ["IMAGETYP"])], ["Image Type", metadataValue(md, ["IMAGETYP"])], ["Stack Count", metadataValue(md, ["STACKCNT", "STACKED"])]];
  const targetRows = [["Object", frameObjectName(f, currentSession)], ["RA", metadataValue(md, ["RA", "OBJCTRA"])], ["DEC", metadataValue(md, ["DEC", "OBJCTDEC"])]];
  const equipmentRows = [["Camera", metadataValue(md, ["INSTRUME", "CAMERA"], f.cameraName)], ["Guide Camera", metadataValue(md, ["GUIDECAM", "GUIDER", "GUIDECAMERA", "GUIDE_CAM"])], ["Telescope / Mount", metadataValue(md, ["TELESCOP", "MOUNT"])], ["Filter", metadataValue(md, ["FILTER"])], ["Bayer Pattern", metadataValue(md, ["BAYERPAT", "BAYERPATTERN"])], ["Creator", metadataValue(md, ["CREATOR", "SWCREATE", "PROGRAM"])], ["Focal Length", metadataValue(md, ["FOCALLEN", "FOCALLENGTH"])], ["Pixel Size", metadataValue(md, ["XPIXSZ", "PIXSIZE"])], ["Focus Position", metadataValue(md, ["FOCUSPOS", "FOCPOS"])]];
  const storageRows = [["Filename", f.originalFilename], ["Checksum", f.checksum ?? "-"], ["Source", f.sourceName ?? "-"], ["Preview", f.previewStorageKey ? "Generated" : "Not generated"]];
  const activeJobs = jobs.filter((j) => j.status === "PENDING" || j.status === "RUNNING");
  const failedJobs = jobs.filter((j) => j.status === "FAILED");
  const statusDescription =
    f.processingStatus === "PENDING"
      ? "Waiting for worker jobs to start."
      : f.processingStatus === "PROCESSING"
        ? "At least one worker job is currently running."
        : f.processingStatus === "FAILED"
          ? "One or more worker jobs failed. See job details below."
          : f.processingStatus === "READY"
            ? "Metadata and preview generation completed."
            : "No processing status is recorded for this frame.";
  return (
    <div className="desktop-grid frame-detail-grid">
      <div>
        <Card className="panel" radius="lg" p="xl">
          <Group justify="space-between" align="flex-start">
            <div>
              <Title order={3}>{frameObjectName(f, currentSession)}</Title>
              <Text c="dimmed" size="sm">{f.originalFilename}</Text>
            </div>
            <FrameTypeBadge type={f.frameType} />
          </Group>
          {previewUrl ? (
            <img
              src={previewUrl}
              className="frame-preview-large"
            />
          ) : (
            <Text c="dimmed" mt="sm">
              No preview
            </Text>
          )}
          <Group mt="sm">
            <StatusBadge status={f.processingStatus} />
            {activeJobs.length ? <Badge variant="light">{activeJobs.length} active job{activeJobs.length === 1 ? "" : "s"}</Badge> : null}
            {failedJobs.length ? <Badge color="red" variant="light">{failedJobs.length} failed job{failedJobs.length === 1 ? "" : "s"}</Badge> : null}
          </Group>
          <Group mt="md">
            {f.session?.id ? <Button component={Link} to={`/sessions/${f.session.id}`} variant="light">Open Session: {currentSession ? sessionDisplayName(currentSession) : "Linked session"}</Button> : <Badge color="gray" variant="light">No linked session</Badge>}
            {f.session?.id ? <Button variant="light" onClick={() => askConfirm({ title: "Detach frame", description: `Detach "${f.originalFilename}" from ${currentSession ? sessionDisplayName(currentSession) : "its current session"}? The raw file is kept, but it will no longer belong to this observing session.`, action: async () => { await api(`/api/frames/${f.id}/detach`, { method: "POST" }); await load(); } })}>Detach Frame</Button> : null}
            <Button
              color="red"
              variant="light"
              onClick={() => askConfirm({
                title: "Delete frame",
                description: `Delete frame "${f.originalFilename}"? This removes the frame record, its queued/finished jobs, the raw FITS file, and generated previews. This cannot be undone.`,
                action: async () => {
                  await api(`/api/frames/${f.id}`, { method: "DELETE" });
                  nav(f.session?.id ? `/sessions/${f.session.id}` : "/frames");
                },
              })}
            >
              Delete Frame
            </Button>
          </Group>
          <Select
            mt="sm"
            placeholder="Move to session..."
            data={sessions
              .filter((s) => s.id !== f.session?.id)
              .map((s) => ({ value: String(s.id), label: sessionDisplayName(s) }))}
            onChange={(v) => {
              if (!v) return;
              const targetSession = sessions.find((s) => s.id === Number(v));
              askConfirm({
                title: "Move frame",
                description: `Move "${f.originalFilename}" to ${targetSession ? sessionDisplayName(targetSession) : "the selected session"}?`,
                action: async () => {
                  await api(`/api/frames/${f.id}/move-to-session/${v}`, {
                    method: "POST",
                  });
                  await load();
                },
              });
            }}
          />
        </Card>
      </div>
      <div>
        <Card className="panel" radius="lg" p="xl">
          <Tabs defaultValue="overview">
            <Tabs.List>
              <Tabs.Tab value="overview">Overview</Tabs.Tab>
              <Tabs.Tab value="status">Status</Tabs.Tab>
              <Tabs.Tab value="advanced">Advanced</Tabs.Tab>
            </Tabs.List>
            <Tabs.Panel value="overview" pt="md">
              <Stack gap="md">
                {[ ["Acquisition", acquisitionRows], ["Target", targetRows], ["Equipment", equipmentRows], ["Storage", storageRows] ].map(([title, rows]) => <Card key={String(title)} className="empty-state" radius="md" p="md"><Title order={5}>{String(title)}</Title><Table mt="sm" className="metadata-table"><Table.Tbody>{(rows as string[][]).map(([k, v]) => <Table.Tr key={k}><Table.Td className="metadata-key"><Text size="sm" c="dimmed">{k}</Text></Table.Td><Table.Td className="metadata-value"><Text fw={700} size="sm">{v}</Text></Table.Td></Table.Tr>)}</Table.Tbody></Table></Card>)}
              </Stack>
            </Tabs.Panel>
            <Tabs.Panel value="status" pt="md">
              <Stack gap="md">
                <Alert color={f.processingStatus === "FAILED" ? "red" : f.processingStatus === "READY" ? "green" : "blue"} variant="light" title={`Frame status: ${f.processingStatus ?? "Not recorded"}`}>
                  {statusDescription}
                </Alert>
                {jobs.length ? (
                  <Stack gap="sm">
                    {jobs.map((j) => (
                      <Paper key={j.id} className="compact-row" p="md" radius="md">
                        <Group justify="space-between" align="flex-start">
                          <div>
                            <Text fw={800}>{j.type}</Text>
                            <Text c="dimmed" size="sm">{j.type}</Text>
                          </div>
                          <Group gap="xs"><StatusBadge status={j.status} />{j.status === "FAILED" ? <Button size="xs" variant="light" onClick={async () => { await api(`/api/jobs/${j.id}/retry`, { method: "POST" }); await loadJobs(); }}>Retry</Button> : null}</Group>
                        </Group>
                        <SimpleGrid cols={{ base: 1, sm: 3 }} mt="sm" spacing="xs">
                          <Text size="xs" c="dimmed">Created: {fmtDate(j.createdAt)}</Text>
                          <Text size="xs" c="dimmed">Started: {fmtDate(j.startedAt)}</Text>
                          <Text size="xs" c="dimmed">Finished: {fmtDate(j.finishedAt)}</Text>
                        </SimpleGrid>
                        {j.errorMessage ? <Alert color="red" variant="light" mt="sm" title="Worker error">{j.errorMessage}</Alert> : null}
                      </Paper>
                    ))}
                  </Stack>
                ) : (
                  <EmptyState title="No worker jobs" message="This frame has no recorded metadata or preview jobs." />
                )}
              </Stack>
            </Tabs.Panel>
            <Tabs.Panel value="advanced" pt="md">
              <Button
                variant="subtle"
                mb="sm"
                onClick={() => setShowRaw((v) => !v)}
              >
                {showRaw ? "Hide FITS Header" : "Show FITS Header"}
              </Button>
              {showRaw ? (
                <pre>{JSON.stringify(raw, null, 2)}</pre>
              ) : (
                <Text c="dimmed">Raw FITS header is hidden by default. Common fields are shown in readable sections.</Text>
              )}
            </Tabs.Panel>
          </Tabs>
        </Card>
      </div>
    </div>
  );
}

function SessionsPage({
  api,
  settings,
  askConfirm,
}: {
  api: ReturnType<typeof useApi>;
  settings: UiSettings;
  askConfirm: (c: Confirm) => void;
}) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [targets, setTargets] = useState<Target[]>([]);
  const [frames, setFrames] = useState<Frame[]>([]);
  const [create, setCreate] = useState<{ targetId?: number; notes?: string }>(
    {},
  );
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [groupKey, setGroupKey] = useState("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadTitle, setUploadTitle] = useState("");
  const load = async () => {
    setLoading(true);
    try {
      setSessions(await (await api("/api/sessions")).json());
      setTargets(await (await api("/api/targets")).json());
      setFrames(await (await api("/api/frames")).json());
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, [api]);
  useAutoRefresh(() => {
    void load();
  }, settings.refreshSeconds);
  const frameCountBySession = frames.reduce<Record<number, number>>(
    (acc, f) => {
      const sid = f.session?.id;
      if (!sid) return acc;
      acc[sid] = (acc[sid] ?? 0) + 1;
      return acc;
    },
    {},
  );
  type SessionListRow =
    | { kind: "session"; session: Session }
    | {
        kind: "group";
        key: string;
        sessions: Session[];
        label: string;
        start?: string;
        end?: string;
        totalIntegration: number;
        totalFrames: number;
      };
  const grouped = sessions.reduce<Record<string, Session[]>>((acc, s) => {
    if (!s.logicalGroupKey) return acc;
    acc[s.logicalGroupKey] = [...(acc[s.logicalGroupKey] ?? []), s];
    return acc;
  }, {});
  const rows: SessionListRow[] = [];
  for (const s of sessions) {
    if (!s.logicalGroupKey) rows.push({ kind: "session", session: s });
  }
  for (const [key, members] of Object.entries(grouped)) {
    if (members.length <= 1) {
      rows.push({ kind: "session", session: members[0] });
      continue;
    }
    const totalIntegration = members.reduce(
      (sum, s) => sum + (s.totalIntegrationTime ?? 0),
      0,
    );
    const totalFrames = members.reduce(
      (sum, s) => sum + (frameCountBySession[s.id] ?? 0),
      0,
    );
    const starts = members
      .map((m) => m.startTime)
      .filter((v): v is string => !!v)
      .sort();
    const ends = members
      .map((m) => m.endTime)
      .filter((v): v is string => !!v)
      .sort();
    rows.push({
      kind: "group",
      key,
      sessions: members,
      label: `${members[0]?.target?.name ?? "Unknown target"} · ${key}`,
      start: starts[0],
      end: ends[ends.length - 1],
      totalIntegration,
      totalFrames,
    });
  }
  const filtered = rows.filter((r) =>
    (r.kind === "group"
      ? `${r.label} ${r.key}`
      : `${sessionLabel(r.session)} ${r.session.notes ?? ""}`
    )
      .toLowerCase()
      .includes(q.toLowerCase()),
  );
  const pages = totalPages(filtered.length, settings.pageSize);
  const visible = pageSlice(filtered, page, settings.pageSize);
  const groupedCount = sessions.filter((s) => s.logicalGroupKey).length;
  const totalIntegration = sessions.reduce(
    (sum, s) => sum + (s.totalIntegrationTime ?? 0),
    0,
  );
  useEffect(() => {
    if (page > pages) setPage(pages);
  }, [page, pages]);
  return (
    <Stack gap="lg">
      <PageHeader
        title="Sessions"
        subtitle="Group imaging nights, review acquisition windows, and attach processed outputs."
        right={
            <TextInput
              placeholder="Search sessions"
              value={q}
              onChange={(e) => {
                setQ(e.currentTarget.value);
                setPage(1);
              }}
            />
        }
      />
      <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} spacing="lg">
        <StatCard label="Sessions" value={sessions.length} icon={<IconFolders size={20} />} />
        <StatCard label="Groups" value={Object.keys(grouped).length} icon={<IconBriefcase size={20} />} />
        <StatCard label="Grouped sessions" value={groupedCount} icon={<IconChartBar size={20} />} />
        <StatCard label="Integration" value={fmtSeconds(totalIntegration, settings.integrationTimeFormat)} icon={<IconMoonStars size={20} />} />
      </SimpleGrid>
      <div className="desktop-grid targets-workspace-grid">
        <div>
          <Card className="panel" radius="lg" p="xl">
            <Group justify="space-between" mb="lg">
              <div>
                <Title order={4}>Session Library</Title>
                <Text c="dimmed" size="sm">Ungrouped sessions and logical session groups.</Text>
              </div>
              <Badge variant="light">{filtered.length} shown</Badge>
            </Group>
            {loading ? (
              <TableSkeleton rows={7} />
            ) : filtered.length === 0 ? (
              <EmptyState title="No sessions found" message="No imaging sessions match the current search." />
            ) : (
              <div className="desktop-grid session-card-grid">
                {visible.map((row) => {
                  const isGroup = row.kind === "group";
                  const title = isGroup ? row.label.replace(" · ", " • ") : sessionDisplayName(row.session);
                  const href = isGroup
                    ? `/session-groups/${encodeURIComponent(row.key)}`
                    : `/sessions/${row.session.id}`;
                  const start = isGroup ? row.start : row.session.startTime;
                  const end = isGroup ? row.end : row.session.endTime;
                  const framesForRow = isGroup
                    ? row.totalFrames
                    : (frameCountBySession[row.session.id] ?? 0);
                  const integrationForRow = isGroup
                    ? row.totalIntegration
                    : (row.session.totalIntegrationTime ?? 0);
                  const rowFrames = isGroup ? [] : frames.filter((f) => f.session?.id === row.session.id);
                  const typeCounts = frameTypeCounts(rowFrames);
                  const camera = isGroup ? "Multiple cameras" : sessionCamera(rowFrames);
                  const filter = isGroup ? "Multiple filters" : sessionFilter(rowFrames);
                  const enrichment = isGroup ? row.sessions.find((s) => s.targetEnrichment)?.targetEnrichment : row.session.targetEnrichment;
                  return (
                    <Card key={isGroup ? `group-${row.key}` : row.session.id} className="session-card astro-session-card" radius="lg" p="lg" withBorder>
                      <Group justify="space-between" align="flex-start">
                        <div>
                          <Text component={Link} to={href} className="table-link" fw={900} size="lg">
                            {title}
                          </Text>
                          <Text c="dimmed" size="sm">
                            {isGroup ? `${row.sessions.length} imaging sessions` : `${sessionDuration(row.session)} duration`}
                          </Text>
                        </div>
                        {isGroup ? <Badge variant="light">Group</Badge> : <Checkbox checked={selectedIds.includes(row.session.id)} onChange={(e) => setSelectedIds((prev) => e.currentTarget.checked ? [...prev, row.session.id] : prev.filter((id) => id !== row.session.id))} />}
                      </Group>
                      <SimpleGrid cols={2} spacing="xs" mt="md">
                        <Paper className="empty-state" p="sm" radius="md"><Text size="xs" c="dimmed">Camera</Text><Text fw={800} size="sm" truncate>{camera}</Text></Paper>
                        <Paper className="empty-state" p="sm" radius="md"><Text size="xs" c="dimmed">Filter</Text><Text fw={800} size="sm" truncate>{filter}</Text></Paper>
                      </SimpleGrid>
                      <SimpleGrid cols={2} spacing="xs" mt="xs">
                        <Paper className="empty-state" p="sm" radius="md"><Text size="xs" c="dimmed">Catalog</Text><Text fw={800} size="sm" truncate>{enrichmentFact(enrichment?.canonicalName ?? (!isGroup ? row.session.target?.name : undefined))}</Text></Paper>
                        <Paper className="empty-state" p="sm" radius="md"><Text size="xs" c="dimmed">Object</Text><Text fw={800} size="sm" truncate>{enrichmentFact(enrichment?.objectType)}</Text></Paper>
                      </SimpleGrid>
                      <Group mt="md" gap="xs">
                        <Badge variant="light">{typeCounts.LIGHT ?? 0} Lights</Badge>
                        <Badge variant="light">{typeCounts.DARK ?? 0} Darks</Badge>
                        <Badge variant="light">{typeCounts.FLAT ?? 0} Flats</Badge>
                        <Badge variant="light">{typeCounts.BIAS ?? 0} Bias</Badge>
                        {enrichment?.constellation ? <Badge variant="light">{enrichment.constellation}</Badge> : null}
                        {enrichment?.magnitude != null ? <Badge variant="light">Mag {enrichment.magnitude}</Badge> : null}
                      </Group>
                      <Group mt="md" justify="space-between">
                        <Text fw={900}>{fmtSeconds(integrationForRow, settings.integrationTimeFormat)} Integration</Text>
                        <Group gap="xs">
                          {framesForRow ? <Badge color="green" variant="light">{framesForRow} frames</Badge> : <Badge color="gray" variant="light">No frames</Badge>}
                          {!isGroup && row.session.logicalGroupKey ? <Badge variant="light">Auto-grouped</Badge> : null}
                        </Group>
                      </Group>
                    </Card>
                  );
                })}
              </div>
            )}
            <ListFooter count={filtered.length} page={page} pages={pages} onPrev={() => setPage((p) => p - 1)} onNext={() => setPage((p) => p + 1)} />
          </Card>
        </div>
        <div>
          <Stack gap="lg">
            <Card className="panel" radius="lg" p="xl">
              <Title order={4}>Group Sessions</Title>
              <Text c="dimmed" size="sm" mt={4}>Select at least two ungrouped sessions from the library.</Text>
              <Stack mt="md" gap="sm">
            <TextInput
              placeholder="Logical group key (optional)"
              value={groupKey}
              onChange={(e) => setGroupKey(e.currentTarget.value)}
            />
            <Button
              variant="default"
              disabled={selectedIds.length < 2}
              onClick={async () => {
                await api("/api/sessions/group", {
                  method: "POST",
                  body: JSON.stringify({
                    logicalGroupKey: groupKey || undefined,
                    sessionIds: selectedIds,
                  }),
                });
                setSelectedIds([]);
                setGroupKey("");
                await load();
              }}
            >
              Group selected sessions
            </Button>
              </Stack>
            </Card>
            <Card className="panel" radius="lg" p="xl">
              <Title order={4}>Upload Result</Title>
              <Text c="dimmed" size="sm" mt={4}>Attach a processed output to the selected sessions.</Text>
              <Stack mt="md" gap="sm">
            <TextInput
              label="Result title"
              placeholder="Master stack / edit"
              value={uploadTitle}
              onChange={(e) => setUploadTitle(e.currentTarget.value)}
            />
            <FileInput
              placeholder="Pick result file"
              value={uploadFile}
              onChange={setUploadFile}
            />
            <Button
              disabled={!uploadFile || selectedIds.length === 0}
              onClick={async () => {
                if (!uploadFile || selectedIds.length === 0) return;
                const form = new FormData();
                form.append("title", uploadTitle || uploadFile.name);
                form.append("file", uploadFile);
                form.append("fileName", uploadFile.name);
                form.append(
                  "contentType",
                  uploadFile.type || "application/octet-stream",
                );
                form.append("sessionIds", selectedIds.join(","));
                await api("/api/sessions/processed-assets/link", {
                  method: "POST",
                  body: form,
                });
                setUploadFile(null);
                setUploadTitle("");
              }}
            >
              Upload result for selected sessions
            </Button>
              </Stack>
            </Card>
        <Card
          className="panel"
          radius="lg"
          p="xl"
          component="form"
          onSubmit={async (e: FormEvent) => {
            e.preventDefault();
            await api("/api/sessions", {
              method: "POST",
              body: JSON.stringify(create),
            });
            setCreate({});
            await load();
          }}
        >
          <Title order={4}>Create Session</Title>
          <Select
            mt="sm"
            label="Target"
            data={targets.map((t) => ({ value: String(t.id), label: t.name }))}
            value={create.targetId ? String(create.targetId) : null}
            onChange={(v) =>
              setCreate((c) => ({ ...c, targetId: v ? Number(v) : undefined }))
            }
            clearable
          />
          <Textarea
            mt="sm"
            label="Notes"
            value={create.notes ?? ""}
            onChange={(e) =>
              setCreate((c) => ({ ...c, notes: e.currentTarget.value }))
            }
          />
          <Button mt="md" type="submit">
            Create Session
          </Button>
        </Card>
          </Stack>
        </div>
      </div>
    </Stack>
  );
}

function SessionDetail({
  api,
  askConfirm,
  settings,
}: {
  api: ReturnType<typeof useApi>;
  askConfirm: (c: Confirm) => void;
  settings: UiSettings;
}) {
  const { id } = useParams();
  const nav = useNavigate();
  const [d, setD] = useState<any>(null);
  const [exports, setExports] = useState<Job[]>([]);
  const [uploadingResult, setUploadingResult] = useState(false);
  const [activeTab, setActiveTab] = useState<string | null>("overview");
  const [selectedFrame, setSelectedFrame] = useState<Frame | null>(null);
  const resultUploadInputRef = useRef<HTMLInputElement | null>(null);
  const load = async () =>
    setD(await (await api(`/api/sessions/${id}`)).json());
  const loadExports = async () =>
    setExports(await (await api(`/api/exports/session/${id}`)).json());
  useEffect(() => {
    void load();
    void loadExports();
  }, [api, id]);
  useAutoRefresh(() => {
    void load();
    void loadExports();
  }, settings.refreshSeconds);
  const session: Session | null = d?.session ?? null;
  const sessionFrames: Frame[] = d?.frames ?? [];
  const processedAssets: ProcessedAsset[] = d?.processedAssets ?? [];
  const typeCounts = frameTypeCounts(sessionFrames);
  const groupedFrames = frameGroupOrder.map((type) => ({ type, frames: sessionFrames.filter((f) => f.frameType === type) })).filter((g) => g.frames.length > 0);
  const camera = sessionCamera(sessionFrames);
  const filter = sessionFilter(sessionFrames);
  const workflow: WorkflowStatus = d?.workflowStatus ?? workflowSummary(sessionFrames, processedAssets);
  if (!session) return <Text c="dimmed">Loading session...</Text>;
  const enrichment = session.targetEnrichment;
  const setManualWorkflowStatus = async (manualWorkflowStatus: string) => {
    await api(`/api/sessions/${id}`, { method: "PATCH", body: JSON.stringify({ manualWorkflowStatus }) });
    await load();
  };
  const uploadResultFile = async (file: File | null | undefined) => {
    if (!file) return;
    setUploadingResult(true);
    try {
      const form = new FormData();
      form.append("title", file.name.replace(/\.[^.]+$/, "") || file.name);
      form.append("file", file);
      form.append("fileName", file.name);
      form.append("contentType", file.type || "application/octet-stream");
      await api(`/api/sessions/${id}/processed-assets`, { method: "POST", body: form });
      await load();
      notifications.show({ title: "Result uploaded", message: `${file.name} was attached to this session.`, color: "green" });
    } catch (error) {
      notifications.show({ title: "Upload failed", message: error instanceof Error ? error.message : "The file could not be uploaded.", color: "red" });
    } finally {
      setUploadingResult(false);
      if (resultUploadInputRef.current) resultUploadInputRef.current.value = "";
    }
  };
  return (
    <Stack gap="lg">
      <input ref={resultUploadInputRef} type="file" style={{ display: "none" }} onChange={(event) => void uploadResultFile(event.currentTarget.files?.[0])} />
      <PageHeader
        title={sessionDisplayName(session)}
        subtitle={`${camera} · ${filter} · ${fmtSeconds(session.totalIntegrationTime, settings.integrationTimeFormat)} integration`}
        right={<Group><Button onClick={async () => { await api(`/api/sessions/${id}/export`, { method: "POST" }); await loadExports(); }}>Export Session</Button><Button variant="light" loading={uploadingResult} onClick={() => { if (resultUploadInputRef.current) resultUploadInputRef.current.value = ""; resultUploadInputRef.current?.click(); }}>Upload Result</Button><Button variant="light" disabled>Edit Session</Button><Button component={Link} to="/sessions" variant="subtle">Back</Button></Group>}
      />
      <Card className="panel workflow-card" radius="lg" p="xl">
        <Group justify="space-between" align="flex-start" mb="md"><div><Title order={4}>Session Progress</Title><Text c="dimmed" size="sm">Set the workflow stage manually or return to automatic status.</Text></div><Group gap="xs"><Badge variant="light">{workflow.manual ? workflow.status : `${workflow.label} complete`}</Badge><Button size="xs" variant={workflow.manual ? "light" : "filled"} onClick={() => void setManualWorkflowStatus("")}>Auto</Button></Group></Group>
        <div className="workflow-control-grid">{workflowManualOptions.map((option) => { const active = session.manualWorkflowStatus === option.value; const done = workflow.steps.some((step) => step.label === option.label && step.done); return <button key={option.value} type="button" className={active ? "workflow-control workflow-control-active" : done ? "workflow-control workflow-control-done" : "workflow-control"} onClick={() => void setManualWorkflowStatus(option.value)}><span>{active || done ? "✓" : ""}</span><strong>{option.label}</strong></button>; })}</div>
      </Card>
      <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} spacing="lg">
        <StatCard label="Lights" value={typeCounts.LIGHT ?? 0} icon={<IconMoonStars size={20} />} />
        <StatCard label="Calibrations" value={(typeCounts.DARK ?? 0) + (typeCounts.FLAT ?? 0) + (typeCounts.BIAS ?? 0) + (typeCounts.DARK_FLAT ?? 0)} icon={<IconChartBar size={20} />} />
        <StatCard label="Integration" value={fmtSeconds(session.totalIntegrationTime, settings.integrationTimeFormat)} icon={<IconCamera size={20} />} />
        <StatCard label="Results" value={processedAssets.length} icon={<IconPhoto size={20} />} />
      </SimpleGrid>
      <div className="desktop-grid session-workspace-grid">
        <div>
          <Card className="panel" radius="lg" p="xl">
            <Group justify="space-between" align="flex-start" mb="lg">
              <div>
                <Title order={4}>Session Workspace</Title>
                <Text c="dimmed" size="sm">Observing night organized by target, acquisition setup, and time window.</Text>
              </div>
              <Group gap="xs">
                {session.logicalGroupKey ? <Badge variant="light">Auto-grouped</Badge> : <Badge variant="light">Manual session</Badge>}
                {processedAssets.length ? <Badge color="green" variant="light">Result Available</Badge> : <Badge color="gray" variant="light">No result yet</Badge>}
              </Group>
            </Group>
            <Tabs value={activeTab} onChange={setActiveTab}>
              <Tabs.List><Tabs.Tab value="overview">Overview</Tabs.Tab><Tabs.Tab value="frames">Frames</Tabs.Tab><Tabs.Tab value="results">Results</Tabs.Tab><Tabs.Tab value="files">Files</Tabs.Tab></Tabs.List>
              <Tabs.Panel value="overview" pt="md">
                <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
                  <Paper className="empty-state" p="lg" radius="md"><Text c="dimmed" size="sm">Target</Text><Title order={4}>{session.target?.name ?? "Unknown Target"}</Title></Paper>
                  <Paper className="empty-state" p="lg" radius="md"><Text c="dimmed" size="sm">Session Date</Text><Title order={4}>{fmtShortDate(session.startTime)}</Title></Paper>
                  <Paper className="empty-state" p="lg" radius="md"><Text c="dimmed" size="sm">Camera</Text><Title order={4}>{camera}</Title></Paper>
                  <Paper className="empty-state" p="lg" radius="md"><Text c="dimmed" size="sm">Filter</Text><Title order={4}>{filter}</Title></Paper>
                </SimpleGrid>
                <Card className="empty-state" radius="md" p="lg" mt="md">
                  <Group justify="space-between" align="flex-start" mb="sm"><div><Text fw={900}>Target Metadata</Text><Text c="dimmed" size="sm">Cached enrichment for this session target. Missing values are not inferred.</Text></div><Badge variant="light">Source: {enrichmentFact(enrichment?.source)}</Badge></Group>
                  <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs">
                    <Paper p="sm" radius="md" withBorder><Text size="xs" c="dimmed">Canonical name</Text><Text fw={700}>{enrichmentFact(enrichment?.canonicalName ?? session.target?.name)}</Text></Paper>
                    <Paper p="sm" radius="md" withBorder><Text size="xs" c="dimmed">Object type</Text><Text fw={700}>{enrichmentFact(enrichment?.objectType)}</Text></Paper>
                    <Paper p="sm" radius="md" withBorder><Text size="xs" c="dimmed">Catalog identifiers</Text><Text fw={700}>{enrichmentFact(enrichment?.catalogIds)}</Text></Paper>
                    <Paper p="sm" radius="md" withBorder><Text size="xs" c="dimmed">Constellation</Text><Text fw={700}>{enrichmentFact(enrichment?.constellation)}</Text></Paper>
                    <Paper p="sm" radius="md" withBorder><Text size="xs" c="dimmed">Coordinates</Text><Text fw={700}>RA {enrichmentFact(enrichment?.ra)} / Dec {enrichmentFact(enrichment?.dec)}</Text></Paper>
                    <Paper p="sm" radius="md" withBorder><Text size="xs" c="dimmed">Magnitude</Text><Text fw={700}>{enrichmentFact(enrichment?.magnitude)}</Text></Paper>
                  </SimpleGrid>
                  <Group mt="sm" gap="xs"><Badge variant="light">Updated: {enrichment?.lastUpdated ? fmtDate(enrichment.lastUpdated) : "Not available"}</Badge>{enrichment?.apparentSize ? <Badge variant="light">Size: {enrichment.apparentSize}</Badge> : null}</Group>
                  <EnrichmentDescriptionDisclosure description={enrichment?.description} source={enrichment?.source} />
                </Card>
                <Card className="empty-state" radius="md" p="lg" mt="md">
                  <Group justify="space-between" align="flex-start"><div><Text fw={900}>Session Intelligence</Text><Text c="dimmed" size="sm">Auto-grouped by Target, Camera, and Time Window.</Text></div><Badge color={session.logicalGroupKey ? "green" : "blue"} variant="light">{session.logicalGroupKey ? "High confidence" : "Manual session"}</Badge></Group>
                  <Group mt="md" gap="xs"><Button size="xs" variant="light" disabled>Move Frame</Button><Button size="xs" variant="light" disabled>Detach Frame</Button><Button size="xs" variant="light" disabled>Merge Sessions</Button><Button size="xs" variant="light" disabled>Split Session</Button>{session.logicalGroupKey ? <Button size="xs" variant="light" onClick={() => nav(`/session-groups/${encodeURIComponent(session.logicalGroupKey!)}`)}>Open Group</Button> : null}</Group>
                </Card>
              </Tabs.Panel>
              <Tabs.Panel value="frames" pt="md">
                {groupedFrames.length ? <Stack gap="lg">{groupedFrames.map((group) => <Card key={group.type} className="empty-state" radius="md" p="md"><Group justify="space-between" mb="md"><div><Title order={5}>{group.type} ({group.frames.length})</Title><Text c="dimmed" size="sm">{fmtSeconds(totalExposure(group.frames), settings.integrationTimeFormat)} total exposure</Text></div><FrameTypeBadge type={group.type} /></Group><div className="session-frame-gallery">{group.frames.map((frame) => <SessionFrameCard key={frame.id} api={api} frame={frame} onZoom={setSelectedFrame} />)}</div></Card>)}</Stack> : <EmptyState title="No frames in session" message="Frames linked to this observing session will appear here." />}
              </Tabs.Panel>
              <Tabs.Panel value="results" pt="md">
                {processedAssets.length ? <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">{processedAssets.map((asset) => <Card key={asset.id} className="result-tile" radius="lg" p={0} withBorder><LazyProcessedAssetImage api={api} asset={asset} height={170} label="No preview" /><Stack gap={4} p="md"><Text fw={900}>{asset.title ?? "Untitled result"}</Text><Text c="dimmed" size="sm">{asset.software ?? "Software n/a"}</Text><Badge size="xs" variant="light">{fmtShortDate(asset.createdAt)}</Badge></Stack></Card>)}</SimpleGrid> : <EmptyState title="No processed results" message="Upload a final stack or processed image for this session." />}
              </Tabs.Panel>
              <Tabs.Panel value="files" pt="md">
                <Stack gap="md"><Group justify="space-between"><div><Title order={5}>Session ZIP Exports</Title><Text c="dimmed" size="sm">Download packaged files for this observing session.</Text></div><Button size="xs" onClick={async () => { await api(`/api/sessions/${id}/export`, { method: "POST" }); await loadExports(); }}>Create Export</Button></Group>{exports.length ? <Stack gap="sm">{exports.map((j) => <Group key={j.id} className="compact-row" justify="space-between"><div><Text fw={800}>Session export</Text>{j.errorMessage ? <Text size="xs" c="red">{j.errorMessage}</Text> : <Text size="xs" c="dimmed">{j.type}</Text>}</div><Group gap="xs"><StatusBadge status={j.status} />{j.status === "COMPLETED" ? <Button size="xs" onClick={() => void downloadExportZip(api, j.id)}>Download ZIP</Button> : <Badge variant="light">Pending</Badge>}<Button size="xs" variant="light" color="red" onClick={async () => { await api(`/api/exports/${j.id}`, { method: "DELETE" }); await loadExports(); }}>Delete</Button></Group></Group>)}</Stack> : <EmptyState title="No exports yet" message="Create a session export from the action above." />}</Stack>
              </Tabs.Panel>
            </Tabs>
          </Card>
        </div>
        <div>
          <Card className="panel" radius="lg" p="xl">
            <Title order={4}>Acquisition Summary</Title>
            <Stack mt="md" gap="sm"><Group justify="space-between"><Text c="dimmed">Date</Text><Text fw={800}>{fmtShortDate(session.startTime)}</Text></Group><Group justify="space-between"><Text c="dimmed">Duration</Text><Text fw={800}>{sessionDuration(session)}</Text></Group><Group justify="space-between"><Text c="dimmed">Frames</Text><Text fw={800}>{sessionFrames.length}</Text></Group><Group justify="space-between"><Text c="dimmed">Camera</Text><Text fw={800}>{camera}</Text></Group><Group justify="space-between"><Text c="dimmed">Filter</Text><Text fw={800}>{filter}</Text></Group><Button color="red" variant="light" disabled={sessionFrames.length > 0} onClick={() => askConfirm({ title: "Delete session", description: "Only empty sessions can be deleted.", action: async () => { await api(`/api/sessions/${id}`, { method: "DELETE" }); nav("/sessions"); } })}>Delete Empty Session</Button></Stack>
          </Card>
        </div>
      </div>
      <Modal opened={!!selectedFrame} onClose={() => setSelectedFrame(null)} title={selectedFrame?.originalFilename ?? "Frame Preview"} size="90%">
        {selectedFrame ? <SelectedFramePreview api={api} frame={selectedFrame} /> : null}
      </Modal>
    </Stack>
  );
}

function JobsPage({
  api,
  askConfirm,
  settings,
}: {
  api: ReturnType<typeof useApi>;
  askConfirm: (c: Confirm) => void;
  settings: UiSettings;
}) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<string | null>("ALL");
  const [selectedJobId, setSelectedJobId] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const load = () => {
    setLoading(true);
    return api("/api/jobs")
      .then((r) => r.json())
      .then(setJobs)
      .finally(() => setLoading(false));
  };
  const retryJob = async (jobId: number) => {
    await api(`/api/jobs/${jobId}/retry`, { method: "POST" });
    await load();
  };
  const cancelJob = (jobId: number) => {
    askConfirm({
      title: "Cancel job",
      description: `Cancel job #${jobId}?`,
      action: async () => {
        await api(`/api/jobs/${jobId}/cancel`, { method: "POST" });
        await load();
      },
    });
  };
  useEffect(() => {
    void load();
  }, [api]);
  useAutoRefresh(() => {
    void load();
  }, settings.refreshSeconds);
  const filtered = jobs.filter(
    (j) =>
      `${j.id} ${j.type}`.toLowerCase().includes(q.toLowerCase()) &&
      (!status || status === "ALL" || j.status === status),
  );
  const pages = totalPages(filtered.length, settings.pageSize);
  const visible = pageSlice(filtered, page, settings.pageSize);
  const selectedJob = jobs.find((j) => j.id === selectedJobId) ?? visible[0];
  const activeCount = jobs.filter((j) => j.status === "PENDING" || j.status === "RUNNING").length;
  const failedCount = jobs.filter((j) => j.status === "FAILED").length;
  useEffect(() => {
    if (page > pages) setPage(pages);
  }, [page, pages]);
  return (
    <Stack gap="lg">
      <PageHeader title="Jobs" subtitle="Track processing, queue health, and long-running work." right={
        <Group>
          <TextInput
            placeholder="Search"
            value={q}
            onChange={(e) => {
              setQ(e.currentTarget.value);
              setPage(1);
            }}
          />
          <Select
            data={[
              "ALL",
              "PENDING",
              "RUNNING",
              "COMPLETED",
              "FAILED",
              "CANCELLED",
            ]}
            value={status}
            onChange={(v) => {
              setStatus(v);
              setPage(1);
            }}
          />
        </Group>
      } />
      <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} spacing="lg"><StatCard label="Jobs" value={jobs.length} icon={<IconBriefcase size={20} />} /><StatCard label="Active" value={activeCount} icon={<IconRocket size={20} />} /><StatCard label="Failed" value={failedCount} icon={<IconAlertCircle size={20} />} /><StatCard label="Refresh" value={settings.refreshSeconds ? `${settings.refreshSeconds}s` : "Off"} icon={<IconSettings size={20} />} /></SimpleGrid>
      <Grid>
        <Grid.Col span={{ base: 12, lg: 8 }}>
          <Card className="panel" radius="lg" p="xl">
            {loading ? (
              <TableSkeleton rows={7} />
            ) : filtered.length === 0 ? (
              <EmptyState title="No jobs found" message="No jobs match the current search or status filter." />
            ) : (
              <Stack gap="sm">
                {visible.map((j) => (
                  <Group
                    key={j.id}
                    className="job-card"
                    justify="space-between"
                    onClick={() => setSelectedJobId(j.id)}
                    style={{ cursor: "pointer" }}
                  >
                    <div>
                      <Text fw={800}>Job #{j.id}</Text>
                      <Text c="dimmed" size="sm">{j.type}</Text>
                    </div>
                    <Group>
                      <StatusBadge status={j.status} />
                      {j.status === "FAILED" ? (
                        <Button
                          size="xs"
                          variant="light"
                          onClick={(event) => {
                            event.stopPropagation();
                            void retryJob(j.id);
                          }}
                        >
                          Retry
                        </Button>
                      ) : null}
                      {j.status === "PENDING" || j.status === "RUNNING" ? (
                        <Button
                          size="xs"
                          color="red"
                          variant="light"
                          onClick={(event) => {
                            event.stopPropagation();
                            cancelJob(j.id);
                          }}
                        >
                          Cancel
                        </Button>
                      ) : null}
                    </Group>
                  </Group>
                ))}
              </Stack>
            )}
            <ListFooter
              count={filtered.length}
              page={page}
              pages={pages}
              onPrev={() => setPage((p) => p - 1)}
              onNext={() => setPage((p) => p + 1)}
            />
          </Card>
        </Grid.Col>
        <Grid.Col span={{ base: 12, lg: 4 }}>
          <Card className="panel" radius="lg" p="xl">
            <Title order={4}>Queue Detail</Title>
            {selectedJob ? (
              <Stack mt="md" gap="sm">
                <Group justify="space-between"><Text c="dimmed">Job</Text><Text fw={800}>#{selectedJob.id}</Text></Group>
                <Group justify="space-between"><Text c="dimmed">Type</Text><Text fw={700}>{selectedJob.type}</Text></Group>
                <Group justify="space-between"><Text c="dimmed">Status</Text><StatusBadge status={selectedJob.status} /></Group>
                <Group justify="space-between"><Text c="dimmed">Started</Text><Text>{fmtDate(selectedJob.startedAt)}</Text></Group>
                <Group justify="space-between"><Text c="dimmed">Finished</Text><Text>{fmtDate(selectedJob.finishedAt)}</Text></Group>
                {selectedJob.status === "FAILED" ? (
                  <Button variant="light" onClick={() => void retryJob(selectedJob.id)}>Retry Job</Button>
                ) : null}
                {selectedJob.status === "PENDING" || selectedJob.status === "RUNNING" ? (
                  <Button color="red" variant="light" onClick={() => cancelJob(selectedJob.id)}>Cancel Job</Button>
                ) : null}
                {selectedJob.errorMessage ? (
                  <Alert color="red" variant="light" title="Error">{selectedJob.errorMessage}</Alert>
                ) : (
                  <EmptyState title="No error" message="This job has no recorded failure message." />
                )}
              </Stack>
            ) : (
              <EmptyState title="No job selected" message="Select a queue item to inspect details." />
            )}
          </Card>
        </Grid.Col>
      </Grid>
    </Stack>
  );
}

function TargetsPage({
  api,
  settings,
}: {
  api: ReturnType<typeof useApi>;
  settings: UiSettings;
}) {
  const [targets, setTargets] = useState<Target[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [frames, setFrames] = useState<Frame[]>([]);
  const [assets, setAssets] = useState<ProcessedAsset[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [targetDetail, setTargetDetail] = useState<TargetDetailData | null>(null);
  const [selectedResult, setSelectedResult] = useState<ProcessedAsset | null>(null);
  const [activeTargetTab, setActiveTargetTab] = useState<string | null>("overview");
  const [refreshingEnrichment, setRefreshingEnrichment] = useState(false);
  const [q, setQ] = useState("");
  const [sortBy, setSortBy] = useState<"date-desc" | "date-asc" | "name-asc" | "name-desc">("date-desc");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    setLoading(true);
    void Promise.all([
      api("/api/targets")
        .then((r) => r.json())
        .then(setTargets),
      api("/api/sessions")
        .then((r) => r.json())
        .then(setSessions),
      api("/api/frames")
        .then((r) => r.json())
        .then(setFrames),
      api("/api/processed-assets")
        .then((r) => r.json())
        .then(setAssets),
    ]).finally(() => setLoading(false));
  }, [api]);
  useAutoRefresh(() => {
    setLoading(true);
    void Promise.all([
      api("/api/targets")
        .then((r) => r.json())
        .then(setTargets),
      api("/api/sessions")
        .then((r) => r.json())
        .then(setSessions),
      api("/api/frames")
        .then((r) => r.json())
        .then(setFrames),
      api("/api/processed-assets")
        .then((r) => r.json())
        .then(setAssets),
    ]).finally(() => setLoading(false));
  }, settings.refreshSeconds);
  useEffect(() => {
    if (!selected) {
      setTargetDetail(null);
      return;
    }
    setActiveTargetTab("overview");
    let active = true;
    void api(`/api/targets/${selected}/detail`)
      .then((r) => r.json())
      .then((detail) => {
        if (active) setTargetDetail(detail);
      })
      .catch(() => {
        if (active) setTargetDetail(null);
      });
    return () => {
      active = false;
    };
  }, [api, selected]);
  const latestSessionByTarget = sessions.reduce<Record<number, number>>((acc, s) => {
    const id = s.target?.id;
    if (!id) return acc;
    acc[id] = Math.max(acc[id] ?? 0, new Date(s.startTime ?? 0).getTime());
    return acc;
  }, {});
  const filteredTargets = targets.filter((t) =>
    `${t.name} ${t.type ?? ""} ${t.notes ?? ""}`
      .toLowerCase()
      .includes(q.toLowerCase()),
  ).sort((a, b) => {
    if (sortBy === "name-asc" || sortBy === "name-desc") {
      const value = a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
      return sortBy === "name-asc" ? value : -value;
    }
    const value = (latestSessionByTarget[b.id] ?? 0) - (latestSessionByTarget[a.id] ?? 0);
    return sortBy === "date-desc" ? value : -value;
  });
  const pages = totalPages(filteredTargets.length, settings.pageSize);
  const visibleTargets = pageSlice(filteredTargets, page, settings.pageSize);
  useEffect(() => {
    if (page > pages) setPage(pages);
  }, [page, pages]);
  const forTarget = targetDetail?.sessions ?? (selected
    ? sessions
        .filter((s) => s.target?.id === Number(selected))
        .sort(
          (a, b) =>
            new Date(b.startTime ?? 0).getTime() -
            new Date(a.startTime ?? 0).getTime(),
        )
    : []);
  const integration = forTarget.reduce(
    (sum, s) => sum + (s.totalIntegrationTime ?? 0),
    0,
  );
  const targetAssets = targetDetail?.results ?? (selected
    ? assets.filter((a) => a.target?.id === Number(selected))
    : []);
  const selectedTarget = targetDetail?.target ?? targets.find((t) => t.id === Number(selected));
  const targetSessionIds = new Set(forTarget.map((s) => s.id));
  const targetFrames = targetDetail?.frames ?? frames.filter((f) => f.session?.id && targetSessionIds.has(f.session.id));
  const latestResult = targetDetail?.latestResult ?? [...targetAssets].sort((a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime())[0];
  const recentTargetSessions = forTarget.slice(0, 4);
  const timeline = targetDetail?.timeline ?? forTarget.slice().reverse().map((s) => ({ sessionId: s.id, startTime: s.startTime, endTime: s.endTime, integrationTime: s.totalIntegrationTime, frameCount: frames.filter((f) => f.session?.id === s.id).length, hasResult: targetAssets.some((a) => a.session?.id === s.id) }));
  const enrichment = targetDetail?.enrichment;
  const fact = (value?: string | number | null) => value === undefined || value === null || value === "" ? "Not available" : String(value);
  const refreshEnrichment = async () => {
    if (!selected) return;
    setRefreshingEnrichment(true);
    try {
      await api(`/api/targets/${selected}/enrichment/refresh`, { method: "POST" });
      notifications.show({ title: "Target enrichment queued", message: "AstroVault will refresh cached catalog data in the background.", color: "cyan" });
      setTargetDetail(await (await api(`/api/targets/${selected}/detail`)).json());
    } finally {
      setRefreshingEnrichment(false);
    }
  };
  return (
    <Stack gap="lg">
      <PageHeader title="Targets" subtitle="Maintain your object catalog, observing history, and processed results." right={
            <Group align="flex-end">
            <Select label="Sort" data={[{ value: "date-desc", label: "Newest first" }, { value: "date-asc", label: "Oldest first" }, { value: "name-asc", label: "Name A-Z" }, { value: "name-desc", label: "Name Z-A" }]} value={sortBy} onChange={(v) => { setSortBy((v as typeof sortBy) ?? "date-desc"); setPage(1); }} />
            <TextInput
              placeholder="Search targets"
              value={q}
              onChange={(e) => {
                setQ(e.currentTarget.value);
                setPage(1);
              }}
            />
            </Group>
          }
      />
      <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} spacing="lg"><StatCard label="Targets" value={targets.length} icon={<IconTargetArrow size={20} />} /><StatCard label="Sessions" value={sessions.length} icon={<IconFolders size={20} />} /><StatCard label="Results" value={assets.length} icon={<IconPhoto size={20} />} /><StatCard label="Shown" value={filteredTargets.length} icon={<IconChartBar size={20} />} /></SimpleGrid>
      <div className="desktop-grid targets-workspace-grid">
        <Card className="panel" radius="lg" p="xl">{loading ? <TableSkeleton rows={7} /> : filteredTargets.length === 0 ? <EmptyState title="No targets found" message="No catalog objects match the current search." /> : <div className="desktop-grid target-card-grid">{visibleTargets.map((t) => { const count = sessions.filter((s) => s.target?.id === t.id).length; const resultCount = assets.filter((a) => a.target?.id === t.id).length; return <Card key={t.id} className="target-card" radius="lg" p="lg" withBorder onClick={() => setSelected(String(t.id))} style={{ cursor: "pointer" }}><Group justify="space-between" align="flex-start"><div><Text fw={900}>{t.name}</Text><Text c="dimmed" size="sm">{t.type ?? "Unknown type"}</Text></div><ThemeIcon variant="light" radius="xl"><IconTargetArrow size={18} /></ThemeIcon></Group><Text c="dimmed" size="sm" mt="md" lineClamp={2}>{t.notes || "No planning notes recorded."}</Text><Group mt="md" gap="xs"><Badge variant="light">{count} sessions</Badge><Badge variant="light">{resultCount} results</Badge></Group></Card>; })}</div>}<ListFooter count={filteredTargets.length} page={page} pages={pages} onPrev={() => setPage((p) => p - 1)} onNext={() => setPage((p) => p + 1)} /></Card>
        <Card className="panel target-hub" radius="lg" p="xl"><Group justify="space-between" align="flex-start"><div><Title order={3}>{selectedTarget?.name ?? "Target Hub"}</Title><Text c="dimmed" size="sm">{selectedTarget ? selectedTarget.type ?? "Deep sky object" : "Choose a target to inspect capture progress."}</Text></div><Select placeholder="Select target" data={targets.map((t) => ({ value: String(t.id), label: t.name }))} value={selected} onChange={setSelected} clearable /></Group>
          {selectedTarget ? <Stack mt="lg" gap="lg">
            <Card className="target-hero" radius="lg" p={0} withBorder onClick={() => latestResult && setSelectedResult(latestResult)}>{latestResult ? <LazyProcessedAssetImage api={api} asset={latestResult} height={230} label="No processed result yet" /> : <PreviewPlaceholder label="No processed result yet" />}<Stack gap={4} p="md"><Text fw={900}>{latestResult?.title ?? "Upload your PixInsight result"}</Text><Text c="dimmed" size="sm">{latestResult ? `${fmtShortDate(latestResult.createdAt)} · ${latestResult.software ?? "Software n/a"}` : "Processed images for this target will become the hero preview."}</Text></Stack></Card>
            <SimpleGrid cols={4} spacing="xs"><Paper className="empty-state" p="sm" radius="md"><Text size="xs" c="dimmed">Sessions</Text><Text fw={900}>{forTarget.length}</Text></Paper><Paper className="empty-state" p="sm" radius="md"><Text size="xs" c="dimmed">Frames</Text><Text fw={900}>{targetFrames.length}</Text></Paper><Paper className="empty-state" p="sm" radius="md"><Text size="xs" c="dimmed">Integration</Text><Text fw={900}>{fmtSeconds(integration, settings.integrationTimeFormat)}</Text></Paper><Paper className="empty-state" p="sm" radius="md"><Text size="xs" c="dimmed">Results</Text><Text fw={900}>{targetAssets.length}</Text></Paper></SimpleGrid>
            <Button size="xs" variant="light" onClick={async () => { await api("/api/sessions", { method: "POST", body: JSON.stringify({ targetId: Number(selected), notes: "Created from target hub" }) }); setSessions(await (await api("/api/sessions")).json()); }}>New session for target</Button>
            <Tabs value={activeTargetTab} onChange={setActiveTargetTab}>
              <Tabs.List>
                <Tabs.Tab value="overview">Overview</Tabs.Tab>
                <Tabs.Tab value="sessions">Sessions</Tabs.Tab>
                <Tabs.Tab value="results">Results</Tabs.Tab>
              </Tabs.List>
              <Tabs.Panel value="overview" pt="md">
                <Stack gap="md">
                  <SimpleGrid cols={3} spacing="xs">
                    <Paper className="empty-state" p="sm" radius="md"><Text size="xs" c="dimmed">Total Sessions</Text><Text fw={900}>{targetDetail?.stats.sessions ?? forTarget.length}</Text></Paper>
                    <Paper className="empty-state" p="sm" radius="md"><Text size="xs" c="dimmed">Total Frames</Text><Text fw={900}>{targetDetail?.stats.frames ?? targetFrames.length}</Text></Paper>
                    <Paper className="empty-state" p="sm" radius="md"><Text size="xs" c="dimmed">Total Integration</Text><Text fw={900}>{fmtSeconds(targetDetail?.stats.integrationTime ?? integration, settings.integrationTimeFormat)}</Text></Paper>
                  </SimpleGrid>
                  <Card className="empty-state" radius="lg" p="md" withBorder>
                    <Group justify="space-between" align="flex-start" mb="sm"><div><Text fw={900}>Astronomical Metadata</Text><Text c="dimmed" size="sm">Cached catalog enrichment. Missing values are not inferred.</Text></div><Button size="xs" variant="light" loading={refreshingEnrichment} onClick={() => void refreshEnrichment()}>Refresh metadata</Button></Group>
                    <EnrichmentDescriptionDisclosure description={enrichment?.description} source={enrichment?.source} />
                    <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs" mt="md">
                      <Paper p="sm" radius="md" withBorder><Text size="xs" c="dimmed">Canonical name</Text><Text fw={700}>{fact(enrichment?.canonicalName ?? selectedTarget.name)}</Text></Paper>
                      <Paper p="sm" radius="md" withBorder><Text size="xs" c="dimmed">Object type</Text><Text fw={700}>{fact(enrichment?.objectType)}</Text></Paper>
                      <Paper p="sm" radius="md" withBorder><Text size="xs" c="dimmed">Catalog identifiers</Text><Text fw={700}>{fact(enrichment?.catalogIds)}</Text></Paper>
                      <Paper p="sm" radius="md" withBorder><Text size="xs" c="dimmed">Constellation</Text><Text fw={700}>{fact(enrichment?.constellation)}</Text></Paper>
                      <Paper p="sm" radius="md" withBorder><Text size="xs" c="dimmed">Coordinates</Text><Text fw={700}>RA {fact(enrichment?.ra ?? selectedTarget.ra)} / Dec {fact(enrichment?.dec ?? selectedTarget.dec)}</Text></Paper>
                      <Paper p="sm" radius="md" withBorder><Text size="xs" c="dimmed">Magnitude</Text><Text fw={700}>{fact(enrichment?.magnitude)}</Text></Paper>
                      <Paper p="sm" radius="md" withBorder><Text size="xs" c="dimmed">Apparent size</Text><Text fw={700}>{fact(enrichment?.apparentSize)}</Text></Paper>
                      <Paper p="sm" radius="md" withBorder><Text size="xs" c="dimmed">Distance</Text><Text fw={700}>{fact(enrichment?.distance)}</Text></Paper>
                    </SimpleGrid>
                    <Group mt="sm" gap="xs"><Badge variant="light">Source: {fact(enrichment?.source)}</Badge><Badge variant="light">Updated: {enrichment?.lastUpdated ? fmtDate(enrichment.lastUpdated) : "Not available"}</Badge></Group>
                    {enrichment?.sourceReference ? <Text mt="xs" size="xs" c="dimmed" component="a" href={enrichment.sourceReference.startsWith("http") ? enrichment.sourceReference : undefined} target="_blank" rel="noreferrer">Reference: {enrichment.sourceReference}</Text> : <Text mt="xs" size="xs" c="dimmed">Reference: Not available</Text>}
                  </Card>
                  <div><Text fw={900} mb="xs">Imaging Timeline</Text>{timeline.length ? <Stack gap="xs">{timeline.map((item) => <Group key={item.sessionId} className="timeline-row" justify="space-between"><div><Text component={Link} to={`/sessions/${item.sessionId}`} className="table-link" fw={700}>{`${selectedTarget.name} • ${fmtShortDate(item.startTime)}`}</Text><Text c="dimmed" size="xs">{item.frameCount} frames · {item.hasResult ? "result available" : "needs result"}</Text></div><Badge variant="light">{fmtSeconds(item.integrationTime, settings.integrationTimeFormat)}</Badge></Group>)}</Stack> : <EmptyState title="No sessions found" message="Import frames from ASIAIR or create the first session for this target." />}</div>
                  <div><Text fw={900} mb="xs">Recent Sessions</Text>{recentTargetSessions.length ? <Stack gap="xs">{recentTargetSessions.map((s) => <Group key={s.id} className="compact-row" justify="space-between"><Text component={Link} to={`/sessions/${s.id}`} className="table-link" fw={700}>{sessionDisplayName(s)}</Text><Badge variant="light">{targetFrames.filter((f) => f.session?.id === s.id).length} frames</Badge></Group>)}</Stack> : <Text c="dimmed" size="sm">No capture nights yet.</Text>}</div>
                </Stack>
              </Tabs.Panel>
              <Tabs.Panel value="sessions" pt="md">{forTarget.length ? <Stack gap="sm">{forTarget.map((s) => { const sf = targetFrames.filter((f) => f.session?.id === s.id); const counts = frameTypeCounts(sf); return <Card key={s.id} className="astro-session-card" radius="lg" p="md" withBorder component={Link} to={`/sessions/${s.id}`} style={{ textDecoration: "none" }}><Group justify="space-between" align="flex-start"><div><Text fw={900}>{fmtShortDate(s.startTime)}</Text><Text c="dimmed" size="sm">{sessionCamera(sf)} · {sessionFilter(sf)}</Text></div><Badge variant="light">{fmtSeconds(s.totalIntegrationTime, settings.integrationTimeFormat)}</Badge></Group><Group mt="sm" gap="xs"><Badge size="xs" variant="light">{counts.LIGHT ?? 0} Lights</Badge><Badge size="xs" variant="light">{counts.DARK ?? 0} Darks</Badge><Badge size="xs" variant="light">{counts.FLAT ?? 0} Flats</Badge><Badge size="xs" variant="light">{counts.BIAS ?? 0} Bias</Badge></Group></Card>; })}</Stack> : <EmptyState title="No sessions found" message="Import frames from ASIAIR to start building this target history." />}</Tabs.Panel>
              <Tabs.Panel value="results" pt="md">{targetAssets.length ? <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">{targetAssets.map((a) => <Card key={a.id} className="result-tile" radius="lg" p={0} withBorder onClick={() => setSelectedResult(a)}><LazyProcessedAssetImage api={api} asset={a} height={150} label="No preview" /><Stack gap={4} p="sm"><Text fw={800} truncate>{a.title ?? "Untitled result"}</Text><Text c="dimmed" size="xs">{fmtShortDate(a.createdAt)}</Text><Group gap={6}>{a.software ? <Badge size="xs" variant="light">{a.software}</Badge> : null}{a.versionLabel ? <Badge size="xs" variant="light">{a.versionLabel}</Badge> : null}</Group></Stack></Card>)}</SimpleGrid> : <EmptyState title="No processed result yet" message="Upload your PixInsight result or final edit to complete this target." />}</Tabs.Panel>
            </Tabs>
          </Stack> : <EmptyState title="Select a target" message="Targets are the top-level hub for sessions, frames, and processed results." />}</Card>
      </div>
      <ProcessedAssetModal api={api} asset={selectedResult} onClose={() => setSelectedResult(null)} onDownload={(asset) => void downloadProcessedAsset(api, asset)} />
    </Stack>
  );
}

function ResultsPage({
  api,
  settings,
}: {
  api: ReturnType<typeof useApi>;
  settings: UiSettings;
}) {
  const [assets, setAssets] = useState<ProcessedAsset[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selectedSessionIds, setSelectedSessionIds] = useState<string[]>([]);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadTitle, setUploadTitle] = useState("");
  const [sortBy, setSortBy] = useState<"object" | "date-desc" | "date-asc">(
    "date-desc",
  );
  const [fullscreenAsset, setFullscreenAsset] = useState<ProcessedAsset | null>(
    null,
  );
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  useEffect(() => {
    setLoading(true);
    api("/api/processed-assets")
      .then((r) => r.json())
      .then(setAssets)
      .finally(() => setLoading(false));
    api("/api/sessions")
      .then((r) => r.json())
      .then(setSessions);
  }, [api]);
  useAutoRefresh(() => {
    setLoading(true);
    void api("/api/processed-assets")
      .then((r) => r.json())
      .then(setAssets)
      .finally(() => setLoading(false));
  }, settings.refreshSeconds);
  const filtered = assets
    .filter((a) =>
      `${a.title ?? ""} ${a.target?.name ?? ""} ${a.software ?? ""} ${a.versionLabel ?? ""}`
        .toLowerCase()
        .includes(q.toLowerCase()),
    )
    .sort((a, b) => {
      if (sortBy === "object") {
        return (a.target?.name ?? "").localeCompare(b.target?.name ?? "");
      }
      const ad = new Date(a.createdAt ?? 0).getTime();
      const bd = new Date(b.createdAt ?? 0).getTime();
      return sortBy === "date-asc" ? ad - bd : bd - ad;
    });
  const pages = totalPages(filtered.length, settings.pageSize);
  const visible = pageSlice(filtered, page, settings.pageSize);
  useEffect(() => {
    if (page > pages) setPage(pages);
  }, [page, pages]);
  return (
    <Stack gap="lg">
      <PageHeader title="Results" subtitle="Review processed outputs, previews, software versions, and session links." right={
        <Group>
          <Select
            w={170}
            data={[
              { value: "date-desc", label: "Date newest" },
              { value: "date-asc", label: "Date oldest" },
              { value: "object", label: "Object A-Z" },
            ]}
            value={sortBy}
            onChange={(v) => {
              setSortBy(
                (v as "object" | "date-desc" | "date-asc") ?? "date-desc",
              );
              setPage(1);
            }}
          />
          <ActionIcon variant={viewMode === "grid" ? "filled" : "light"} color="cyan" onClick={() => setViewMode("grid")}><IconLayoutGrid size={16} /></ActionIcon>
          <ActionIcon variant={viewMode === "list" ? "filled" : "light"} color="cyan" onClick={() => setViewMode("list")}><IconTable size={16} /></ActionIcon>
          <TextInput
            placeholder="Search results"
            value={q}
            onChange={(e) => {
              setQ(e.currentTarget.value);
              setPage(1);
            }}
          />
        </Group>}
      />
      <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} spacing="lg">
        <StatCard label="Results" value={assets.length} icon={<IconPhoto size={20} />} />
        <StatCard label="Targets" value={new Set(assets.map((a) => a.target?.id).filter(Boolean)).size} icon={<IconTargetArrow size={20} />} />
        <StatCard label="Linked sessions" value={new Set(assets.map((a) => a.session?.id).filter(Boolean)).size} icon={<IconFolders size={20} />} />
        <StatCard label="Software" value={new Set(assets.map((a) => a.software).filter(Boolean)).size} icon={<IconSettings size={20} />} />
      </SimpleGrid>
      <div className={settings.showResultUploadPanel ? "desktop-grid targets-workspace-grid" : "desktop-grid"}><Card className="panel" radius="lg" p="xl"><Group justify="space-between" mb="lg"><div><Title order={4}>Result Gallery</Title><Text c="dimmed" size="sm">Processed images first, metadata second.</Text></div><Badge variant="light">{filtered.length} shown</Badge></Group>
      {loading ? (
        <TableSkeleton rows={7} />
      ) : filtered.length === 0 ? (
        <EmptyState title="No processed result yet" message="Upload your PixInsight result or final edit from the upload panel." />
      ) : viewMode === "list" ? (
        <Stack gap="md">{visible.map((a) => <Card key={a.id} className="result-list-row" radius="lg" p="md" withBorder onClick={() => setFullscreenAsset(a)}><Group align="center" wrap="nowrap"><div style={{ width: 180, flexShrink: 0 }}><LazyProcessedAssetImage api={api} asset={a} height={112} label="No preview" /></div><Stack gap={4} style={{ flex: 1 }}><Text fw={900}>{a.title ?? "Untitled result"}</Text><Text c="dimmed" size="sm">{normalizeTargetName(a.target?.name)}</Text><Group gap={6}><Badge size="xs" variant="light">{fmtShortDate(a.createdAt)}</Badge>{a.software ? <Badge size="xs" variant="light">{a.software}</Badge> : null}{a.versionLabel ? <Badge size="xs" variant="light">{a.versionLabel}</Badge> : null}</Group></Stack></Group></Card>)}</Stack>
      ) : (
        <div className="desktop-grid results-gallery-grid">
          {visible.map((a) => (
            <Card key={a.id} withBorder radius="lg" p={0} className="result-tile result-gallery-card" onClick={() => setFullscreenAsset(a)}>
              <LazyProcessedAssetImage api={api} asset={a} height={settings.compactCards ? 190 : 270} label={a.storageKey ? "Preview not available" : "No file reference"} />
              <Stack gap="xs" p={settings.compactCards ? "sm" : "md"}><Group justify="space-between" align="flex-start"><div><Text fw={900} truncate>{a.title ?? "Untitled result"}</Text><Text size="sm" c="dimmed" truncate>{normalizeTargetName(a.target?.name)}</Text></div><Badge size="xs" variant="light">{fmtShortDate(a.createdAt)}</Badge></Group><Group gap={6}>{a.software ? <Badge size="xs" variant="light">{a.software}</Badge> : <Badge size="xs" variant="light" color="gray">Software n/a</Badge>}{a.versionLabel ? <Badge size="xs" variant="light">{a.versionLabel}</Badge> : null}</Group></Stack>
            </Card>
          ))}
        </div>
      )}
      <ListFooter count={filtered.length} page={page} pages={pages} onPrev={() => setPage((p) => p - 1)} onNext={() => setPage((p) => p + 1)} /></Card>
      {settings.showResultUploadPanel ? <Card className="panel" radius="lg" p="xl"><Title order={4}>Upload Result</Title><Text c="dimmed" size="sm" mt={4}>Attach a processed file to one or more sessions.</Text><Stack mt="lg" gap="md">
        <MultiSelect
          label="Link to sessions"
          placeholder="Select sessions"
          data={sessions.map((s) => ({
            value: String(s.id),
            label: sessionLabel(s),
          }))}
          value={selectedSessionIds}
          onChange={setSelectedSessionIds}
        />
        <TextInput
          label="Title"
          value={uploadTitle}
          onChange={(e) => setUploadTitle(e.currentTarget.value)}
        />
        <FileInput
          label="Result file"
          placeholder="Pick result file"
          value={uploadFile}
          onChange={setUploadFile}
        />
        <Button
          disabled={!uploadFile || selectedSessionIds.length === 0}
          onClick={async () => {
            if (!uploadFile || selectedSessionIds.length === 0) return;
            const form = new FormData();
            form.append("title", uploadTitle || uploadFile.name);
            form.append("file", uploadFile);
            form.append("fileName", uploadFile.name);
            form.append(
              "contentType",
              uploadFile.type || "application/octet-stream",
            );
            form.append("sessionIds", selectedSessionIds.join(","));
            await api("/api/sessions/processed-assets/link", {
              method: "POST",
              body: form,
            });
            setUploadFile(null);
            setUploadTitle("");
            setLoading(true);
            setAssets(await (await api("/api/processed-assets")).json());
            setLoading(false);
          }}
        >
          Upload Result
        </Button>
      </Stack></Card> : null}</div>
      <Modal
        opened={!!fullscreenAsset}
        onClose={() => setFullscreenAsset(null)}
        title={fullscreenAsset?.title ?? "Result"}
        size="90%"
      >
        {fullscreenAsset ? <Stack gap="md"><LazyProcessedAssetImage api={api} asset={fullscreenAsset} label="Preview not available" /><Group justify="flex-end"><Button onClick={() => void downloadProcessedAsset(api, fullscreenAsset)}>Download file</Button></Group></Stack> : null}
      </Modal>
    </Stack>
  );
}

function SessionGroupDetail({
  api,
  settings,
}: {
  api: ReturnType<typeof useApi>;
  settings: UiSettings;
}) {
  const { key } = useParams();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [frames, setFrames] = useState<Frame[]>([]);
  const [exports, setExports] = useState<Job[]>([]);
  const groupKey = decodeURIComponent(key ?? "");
  const loadGroupData = async () => {
    const allSessions: Session[] = await (await api("/api/sessions")).json();
    setSessions(allSessions);
    setFrames(await (await api("/api/frames")).json());
    const members = allSessions.filter((s) => s.logicalGroupKey === groupKey);
    const exportLists = await Promise.all(
      members.map((s) =>
        api(`/api/exports/session/${s.id}`)
          .then((r) => r.json())
          .catch(() => [] as Job[]),
      ),
    );
    const merged = exportLists.flat();
    const unique = Array.from(
      new Map(merged.map((j) => [j.id, j])).values(),
    ).sort((a, b) => b.id - a.id);
    setExports(unique);
  };
  useEffect(() => {
    void loadGroupData();
  }, [api, key]);
  useAutoRefresh(() => {
    void loadGroupData();
  }, settings.refreshSeconds);
  const members = sessions.filter((s) => s.logicalGroupKey === groupKey);
  const memberIds = new Set(members.map((m) => m.id));
  const frameCount = frames.filter(
    (f) => f.session?.id && memberIds.has(f.session.id),
  ).length;
  const integration = members.reduce(
    (sum, s) => sum + (s.totalIntegrationTime ?? 0),
    0,
  );
  if (!groupKey) return <Text c="dimmed">Group not found.</Text>;
  return (
    <Stack gap="lg">
      <PageHeader
        title={`Session Group: ${groupKey}`}
        subtitle="Logical acquisition group spanning multiple sessions."
        right={<Button component={Link} to="/sessions" variant="light">Back to sessions</Button>}
      />
      <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} spacing="lg">
        <StatCard label="Sessions" value={members.length} icon={<IconFolders size={20} />} />
        <StatCard label="Frames" value={frameCount} icon={<IconCamera size={20} />} />
        <StatCard label="Integration" value={fmtSeconds(integration, settings.integrationTimeFormat)} icon={<IconMoonStars size={20} />} />
        <StatCard label="Exports" value={exports.length} icon={<IconRocket size={20} />} />
      </SimpleGrid>
      <Grid>
        <Grid.Col span={{ base: 12, lg: 8 }}>
          <Card className="panel" radius="lg" p="xl">
            <Group justify="space-between" mb="lg" align="flex-start">
              <div>
                <Title order={4}>Group Members</Title>
                <Text c="dimmed" size="sm">Sessions linked by logical group key.</Text>
              </div>
              {members[0] ? <Button onClick={async () => { await api(`/api/sessions/${members[0].id}/export`, { method: "POST" }); await loadGroupData(); }}>Export This Group</Button> : null}
            </Group>
            {members.length ? <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">{members.map((s) => <Card key={s.id} className="session-card" radius="lg" p="lg" withBorder><Group justify="space-between" align="flex-start"><div><Text component={Link} className="table-link" to={`/sessions/${s.id}`} fw={900}>{sessionLabel(s)}</Text><Text c="dimmed" size="sm">{fmtDate(s.startTime)} - {fmtDate(s.endTime)}</Text></div><ThemeIcon variant="light" radius="xl"><IconFolders size={18} /></ThemeIcon></Group><Group mt="md" gap="xs"><Badge variant="light">{fmtSeconds(s.totalIntegrationTime, settings.integrationTimeFormat)}</Badge><Badge variant="light">{frames.filter((f) => f.session?.id === s.id).length} frames</Badge><Badge variant="light">{s.target?.name ?? "Unknown target"}</Badge></Group></Card>)}</SimpleGrid> : <EmptyState title="No group members" message="No sessions currently use this group key." />}
          </Card>
        </Grid.Col>
        <Grid.Col span={{ base: 12, lg: 4 }}>
          <Card className="panel" radius="lg" p="xl">
            <Title order={4}>Group Exports</Title>
            <Text c="dimmed" size="sm" mt={4}>ZIP exports created from this logical group.</Text>
            <Stack mt="md" gap="sm">
              {exports.length ? exports.map((j) => <Group key={j.id} className="compact-row" justify="space-between"><div><Text fw={800}>Export job #{j.id}</Text><Text c="dimmed" size="xs">{j.type}</Text></div><Group gap="xs"><StatusBadge status={j.status} />{j.status === "COMPLETED" ? <Button size="xs" onClick={() => void downloadExportZip(api, j.id)}>Download ZIP</Button> : <Badge variant="light">Pending</Badge>}<Button size="xs" variant="light" color="red" onClick={async () => { await api(`/api/exports/${j.id}`, { method: "DELETE" }); await loadGroupData(); }}>Delete</Button></Group></Group>) : <EmptyState title="No exports yet" message="Create a group export from the action above." />}
            </Stack>
          </Card>
        </Grid.Col>
      </Grid>
    </Stack>
  );
}

function SettingsPage({
  settings,
  setSettings,
}: {
  settings: UiSettings;
  setSettings: (next: UiSettings) => void;
}) {
  const updateSetting = <K extends keyof UiSettings>(key: K, value: UiSettings[K]) => setSettings({ ...settings, [key]: value });
  return (
    <Stack gap="lg">
      <PageHeader title="Account Settings" subtitle="Tune how AstroVault loads, displays, and refreshes your library." right={<Button variant="light" onClick={() => setSettings(defaultUiSettings)}>Reset defaults</Button>} />
      <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} spacing="lg">
        <StatCard label="Page size" value={settings.pageSize} icon={<IconTable size={20} />} />
        <StatCard label="Refresh" value={settings.refreshSeconds ? `${settings.refreshSeconds}s` : "Off"} icon={<IconRocket size={20} />} />
        <StatCard label="Preview batch" value={settings.previewBatchSize} icon={<IconPhoto size={20} />} />
        <StatCard label="Frame view" value={settings.defaultFrameView} icon={<IconLayoutGrid size={20} />} />
      </SimpleGrid>
      <Grid>
        <Grid.Col span={{ base: 12, lg: 7 }}><Card className="panel" radius="lg" p="xl"><Title order={4}>Library Behavior</Title><Text c="dimmed" size="sm" mt={4}>These settings directly change pagination, default views, sorting, and preview loading.</Text><SimpleGrid cols={{ base: 1, sm: 2 }} spacing="lg" mt="lg"><Select label="Default frame view" data={[{ value: "grid", label: "Grid cards" }, { value: "list", label: "Detail table" }]} value={settings.defaultFrameView} onChange={(v) => updateSetting("defaultFrameView", (v as "grid" | "list") || "grid")} /><Select label="Default results sort" data={[{ value: "date-desc", label: "Newest first" }, { value: "date-asc", label: "Oldest first" }, { value: "object", label: "Object A-Z" }]} value={settings.defaultResultsSort} onChange={(v) => updateSetting("defaultResultsSort", (v as UiSettings["defaultResultsSort"]) ?? "date-desc")} /><Select label="Default list page size" data={["10", "15", "25", "50"]} value={String(settings.pageSize)} onChange={(v) => updateSetting("pageSize", Number(v ?? 15))} /><Select label="Preview load batch" data={["4", "6", "12", "18", "24"]} value={String(settings.previewBatchSize)} onChange={(v) => updateSetting("previewBatchSize", Number(v ?? 12))} /><Select label="Integration time format" data={[{ value: "auto", label: "Auto" }, { value: "minutes", label: "Minutes" }, { value: "hours", label: "Hours" }, { value: "days", label: "Days" }, { value: "hms", label: "H:M:S" }, { value: "seconds", label: "Seconds" }]} value={settings.integrationTimeFormat} onChange={(v) => updateSetting("integrationTimeFormat", (v as UiSettings["integrationTimeFormat"]) ?? "auto")} /><Select label="Auto refresh interval" data={[{ value: "0", label: "Off" }, { value: "10", label: "10 seconds" }, { value: "20", label: "20 seconds" }, { value: "30", label: "30 seconds" }, { value: "60", label: "1 minute" }, { value: "120", label: "2 minutes" }]} value={String(settings.refreshSeconds)} onChange={(v) => updateSetting("refreshSeconds", Number(v ?? 30))} /></SimpleGrid></Card></Grid.Col>
        <Grid.Col span={{ base: 12, lg: 5 }}><Stack gap="lg"><Card className="panel" radius="lg" p="xl"><Title order={4}>Workspace Display</Title><Stack mt="lg" gap="md"><Switch label="Compact cards" description="Reduces image height and card padding in Frames and Results." checked={settings.compactCards} onChange={(e) => updateSetting("compactCards", e.currentTarget.checked)} /><Switch label="Show Results upload panel" description="Controls whether the upload workspace is shown on the Results page." checked={settings.showResultUploadPanel} onChange={(e) => updateSetting("showResultUploadPanel", e.currentTarget.checked)} /></Stack></Card><Card className="panel" radius="lg" p="xl"><Title order={4}>Saved Locally</Title><Text c="dimmed" size="sm" mt={4}>Settings are stored in this browser under <code>ui-settings</code>.</Text><Stack gap="sm" mt="md"><Group justify="space-between" className="compact-row"><Text c="dimmed">Cards</Text><Text fw={700}>{settings.compactCards ? "Compact" : "Comfortable"}</Text></Group><Group justify="space-between" className="compact-row"><Text c="dimmed">Results upload</Text><Text fw={700}>{settings.showResultUploadPanel ? "Visible" : "Hidden"}</Text></Group><Group justify="space-between" className="compact-row"><Text c="dimmed">Results sort</Text><Text fw={700}>{settings.defaultResultsSort}</Text></Group></Stack></Card></Stack></Grid.Col>
      </Grid>
    </Stack>
  );
}

function Shell({
  children,
  onLogout,
}: {
  children: React.ReactNode;
  onLogout: () => void;
}) {
  const nav = useNavigate();
  return (
    <AppShell
      header={{ height: 60 }}
      navbar={{ width: 250, breakpoint: "sm" }}
      padding="lg"
    >
      <AppShell.Navbar
        p="md"
        style={{
          borderRight: "0",
          background: "rgba(7,12,20,0.9)",
          backdropFilter: "blur(10px)",
        }}
      >
        <Group mb="md" gap="sm" className="brand-row">
          <BrandMark size={46} />
          <Title order={3}>AstroVault</Title>
        </Group>
        <NavLink
          variant="subtle"
          component={RouterNavLink}
          to="/dashboard"
          label="Dashboard"
        />
        <NavLink
          variant="subtle"
          component={RouterNavLink}
          to="/targets"
          label="Targets"
        />
        <NavLink
          variant="subtle"
          component={RouterNavLink}
          to="/sessions"
          label="Sessions"
        />
        <NavLink
          variant="subtle"
          component={RouterNavLink}
          to="/frames"
          label="Frames"
        />
        <NavLink
          variant="subtle"
          component={RouterNavLink}
          to="/results"
          label="Results"
        />
        <NavLink
          variant="subtle"
          component={RouterNavLink}
          to="/jobs"
          label="Jobs"
        />
        <NavLink
          variant="subtle"
          component={RouterNavLink}
          to="/settings"
          label="Settings"
        />
      </AppShell.Navbar>
      <AppShell.Header
        p="sm"
        style={{
          borderBottom: "1px solid rgba(160,184,220,0.12)",
          backdropFilter: "blur(8px)",
          background: "rgba(8,12,18,0.92)",
        }}
      >
        <Group h="100%" justify="space-between" className="header-bar">
          <Group className="header-left" gap="sm">
            <Button
              variant="subtle"
              size="sm"
              className="back-btn"
              leftSection={<IconArrowLeft size={16} />}
              onClick={() =>
                window.history.length > 1 ? nav(-1) : nav("/dashboard")
              }
            >
              {window.history.length > 1 ? "Back" : "Dashboard"}
            </Button>
            <Group gap="xs" className="header-brand"><BrandMark size={34} /><Text fw={800}>AstroVault</Text><Text c="dimmed" size="sm" className="header-subtitle">Astrophotography Library</Text></Group>
          </Group>
          <Group className="header-right">
            <Menu shadow="md" width={180}>
              <Menu.Target>
                <ActionIcon variant="light" color="cyan" size="lg">
                  <IconDotsVertical size={16} />
                </ActionIcon>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Item component={RouterNavLink} to="/settings">
                  Settings
                </Menu.Item>
                <Menu.Item color="red" onClick={onLogout}>
                  Logout
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
          </Group>
        </Group>
      </AppShell.Header>
      <AppShell.Main className="app-main"><div className="app-content">{children}</div></AppShell.Main>
    </AppShell>
  );
}

function App() {
  const [token, setToken] = useState<string | null>(
    localStorage.getItem("token"),
  );
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [error, setError] = useState("");
  const [settings, setSettings] = useState<UiSettings>(() => {
    const raw = localStorage.getItem("ui-settings");
    if (!raw) return defaultUiSettings;
    try {
      return {
        ...defaultUiSettings,
        ...(JSON.parse(raw) as Partial<UiSettings>),
      };
    } catch {
      return defaultUiSettings;
    }
  });
  const api = useApi(token, () => setToken(null));
  useEffect(() => {
    if (token) localStorage.setItem("token", token);
    else localStorage.removeItem("token");
  }, [token]);
  useEffect(() => {
    localStorage.setItem("ui-settings", JSON.stringify(settings));
  }, [settings]);
  return (
    <MantineProvider
      defaultColorScheme="dark"
      theme={{ primaryColor: "blue", fontFamily: "Sora, Inter, sans-serif" }}
    >
      <Notifications />
      <BrowserRouter>
        <Modal
          opened={!!confirm}
          onClose={() => setConfirm(null)}
          title={confirm?.title}
        >
          <Text mb="md">{confirm?.description}</Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button
              onClick={async () => {
                try {
                  await confirm?.action();
                  setConfirm(null);
                } catch (e: any) {
                  setError(e.message);
                }
              }}
            >
              Confirm
            </Button>
          </Group>
        </Modal>
        {error && (
          <Notification
            color="red"
            icon={<IconAlertCircle size={16} />}
            onClose={() => setError("")}
          >
            {error}
          </Notification>
        )}
        <Routes>
          <Route path="/login" element={<Login onToken={setToken} />} />
          <Route
            path="*"
            element={
              token ? (
                <Shell onLogout={() => { void fetch(`${apiBase}/api/auth/logout`, { method: "POST", credentials: "include" }); setToken(null); }}>
                  <Routes>
                    <Route
                      path="/dashboard"
                      element={<Dashboard api={api} settings={settings} />}
                    />
                    <Route
                      path="/targets"
                      element={<TargetsPage api={api} settings={settings} />}
                    />
                    <Route
                      path="/sessions"
                      element={<SessionsPage api={api} settings={settings} askConfirm={setConfirm} />}
                    />
                    <Route
                      path="/sessions/:id"
                      element={
                        <SessionDetail
                          api={api}
                          askConfirm={setConfirm}
                          settings={settings}
                        />
                      }
                    />
                    <Route
                      path="/session-groups/:key"
                      element={
                        <SessionGroupDetail api={api} settings={settings} />
                      }
                    />
                    <Route
                      path="/frames"
                      element={<FramesPage api={api} settings={settings} />}
                    />
                    <Route
                      path="/frames/:id"
                      element={
                        <FrameDetail api={api} askConfirm={setConfirm} />
                      }
                    />
                    <Route
                      path="/results"
                      element={<ResultsPage api={api} settings={settings} />}
                    />
                    <Route
                      path="/jobs"
                      element={
                        <JobsPage
                          api={api}
                          askConfirm={setConfirm}
                          settings={settings}
                        />
                      }
                    />
                    <Route
                      path="/settings"
                      element={
                        <SettingsPage
                          settings={settings}
                          setSettings={setSettings}
                        />
                      }
                    />
                    <Route path="*" element={<Dashboard api={api} settings={settings} />} />
                  </Routes>
                </Shell>
              ) : (
                <Login onToken={setToken} />
              )
            }
          />
        </Routes>
      </BrowserRouter>
    </MantineProvider>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
