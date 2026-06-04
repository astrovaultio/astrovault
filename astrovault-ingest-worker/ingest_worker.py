import hashlib
import logging
import os
import re
import tempfile
import time
from dataclasses import dataclass

import requests
from minio import Minio
from smbclient import ClientConfig, listdir, lstat, open_file, path as smbpath, register_session


logging.basicConfig(level=os.getenv("ASTROVAULT_LOG_LEVEL", "INFO").upper(), format="%(asctime)s %(levelname)s [asiair-ingest] %(message)s")
LOG = logging.getLogger("astrovault.asiair_ingest")
logging.getLogger("smbprotocol").setLevel(logging.WARNING)
logging.getLogger("smbclient").setLevel(logging.WARNING)


def env_bool(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.lower() in {"1", "true", "yes", "on"}


@dataclass
class Config:
    backend_url: str = os.getenv("ASTROVAULT_BACKEND_URL", "http://backend:8080")
    worker_token: str = os.getenv("ASTROVAULT_WORKER_TOKEN", "worker-token-dev")
    asiair_host: str = os.getenv("ASIAIR_HOST", "")
    asiair_share: str = os.getenv("ASIAIR_SHARE", "")
    asiair_username: str = os.getenv("ASIAIR_USERNAME", "")
    asiair_password: str = os.getenv("ASIAIR_PASSWORD", "")
    asiair_base_path: str = os.getenv("ASIAIR_BASE_PATH", "/")
    asiair_smb_require_signing: bool = env_bool("ASIAIR_SMB_REQUIRE_SIGNING", False)
    asiair_smb_require_secure_negotiate: bool = env_bool("ASIAIR_SMB_REQUIRE_SECURE_NEGOTIATE", False)
    poll_interval_seconds: int = int(os.getenv("ASIAIR_POLL_INTERVAL_SECONDS", "15"))
    file_stable_seconds: int = int(os.getenv("ASIAIR_FILE_STABLE_SECONDS", "20"))
    max_scan_depth: int = int(os.getenv("ASIAIR_MAX_SCAN_DEPTH", "8"))
    enabled: bool = os.getenv("ASIAIR_ENABLED", "false").lower() == "true"
    minio_endpoint: str = os.getenv("ASTROVAULT_MINIO_ENDPOINT", "minio:9000")
    minio_access_key: str = os.getenv("ASTROVAULT_MINIO_ACCESS_KEY", "astrovault")
    minio_secret_key: str = os.getenv("ASTROVAULT_MINIO_SECRET_KEY", "astrovault123")


class StableTracker:
    def __init__(self, stable_seconds: int):
        self.stable_seconds = stable_seconds
        self._seen = {}

    def is_stable(self, key: str, size: int, mtime_ts: float, now_ts: float) -> bool:
        prev = self._seen.get(key)
        self._seen[key] = (size, mtime_ts, now_ts)
        if prev is None:
            return False
        prev_size, prev_mtime, _ = prev
        if prev_size != size or prev_mtime != mtime_ts:
            return False
        return (now_ts - mtime_ts) >= self.stable_seconds


def smb_url(cfg: Config) -> str:
    base = cfg.asiair_base_path.strip("/")
    return f"\\\\{cfg.asiair_host}\\{cfg.asiair_share}\\{base}" if base else f"\\\\{cfg.asiair_host}\\{cfg.asiair_share}"


def smb_join(base: str, name: str) -> str:
    return f"{base.rstrip('\\\\')}\\{name.lstrip('\\\\')}"


@dataclass(frozen=True)
class AsiairFile:
    remote: str
    relative_path: str
    filename: str
    target_name: str | None
    plan_name: str | None
    frame_type: str | None


@dataclass
class ScanStats:
    dirs_seen: int = 0
    dirs_skipped: int = 0
    paths_seen: int = 0
    fits_candidates: int = 0


def path_parts(path: str) -> list[str]:
    return [p for p in re.split(r"[\\/]+", path) if p]


def filename(path: str) -> str:
    parts = path_parts(path)
    return parts[-1] if parts else path


def normalize_relative(root: str, full: str) -> str:
    root_norm = root.replace("\\", "/").rstrip("/")
    full_norm = full.replace("\\", "/")
    if full_norm.startswith(root_norm + "/"):
        return full_norm[len(root_norm) + 1:]
    return filename(full)


def frame_type_from_parts(parts: list[str], file_name: str) -> str | None:
    haystack = [p.upper().replace(" ", "_").replace("-", "_") for p in parts + [file_name]]
    compact = [p.replace("_", "") for p in haystack]
    if any("MASTERDARKFLAT" in p or "DARK_FLAT" in p or "DARKFLAT" in p for p in haystack + compact):
        return "DARK_FLAT"
    if any("MASTERDARK" in p or p == "DARK" or "_DARK_" in f"_{p}_" for p in haystack + compact):
        return "DARK"
    if any("MASTERFLAT" in p or p == "FLAT" or "_FLAT_" in f"_{p}_" for p in haystack + compact):
        return "FLAT"
    if any("MASTERBIAS" in p or p == "BIAS" or "_BIAS_" in f"_{p}_" for p in haystack + compact):
        return "BIAS"
    if any(p == "LIGHT" or "_LIGHT_" in f"_{p}_" for p in haystack):
        return "LIGHT"
    return None


def classify_asiair_path(root: str, full: str) -> AsiairFile:
    rel = normalize_relative(root, full)
    parts = path_parts(rel)
    file_name = parts[-1] if parts else filename(full)
    dirs = parts[:-1]
    frame_type = frame_type_from_parts(dirs, file_name)
    ignored_context = {
        "autorun", "auto_run", "light", "lights", "dark", "darks", "flat", "flats",
        "bias", "dark_flat", "darkflat", "preview", "video", "log", "logs",
    }
    semantic_dirs = [
        d for d in dirs
        if d.lower().replace(" ", "_").replace("-", "_") not in ignored_context
    ]
    target_name = semantic_dirs[-1] if semantic_dirs else None
    plan_name = semantic_dirs[-2] if len(semantic_dirs) >= 2 else None
    return AsiairFile(full, rel, file_name, target_name, plan_name, frame_type)


def should_descend_dir(name: str) -> bool:
    lowered = name.lower()
    return not (lowered.startswith(".") or lowered in {"@eadir", "#recycle", "system volume information"})


def collect_fits(root: str, max_depth: int) -> tuple[list[AsiairFile], ScanStats]:
    out: list[AsiairFile] = []
    stats = ScanStats()
    stack = [(root, 0)]
    visited = set()
    while stack:
        current, depth = stack.pop()
        stats.dirs_seen += 1
        current_key = current.replace("\\", "/").rstrip("/").lower()
        if current_key in visited:
            continue
        visited.add(current_key)
        if depth > max_depth:
            stats.dirs_skipped += 1
            LOG.debug("Skipping SMB path beyond max depth depth=%s path=%s", depth, current)
            continue
        try:
            names = listdir(current)
        except Exception as exc:
            stats.dirs_skipped += 1
            LOG.warning("Skipping SMB directory %s: %s", current, exc)
            continue
        for name in names:
            stats.paths_seen += 1
            full = smb_join(current, name)
            try:
                lstat(full)
                if smbpath.isdir(full):
                    if depth < max_depth and should_descend_dir(name):
                        stack.append((full, depth + 1))
                    continue
                if name.lower().endswith((".fits", ".fit", ".fts")):
                    stats.fits_candidates += 1
                    out.append(classify_asiair_path(root, full))
            except Exception as exc:
                LOG.warning("Skipping SMB path %s: %s", full, exc)
    return out, stats


def sha256_file(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while True:
            b = f.read(1024 * 1024)
            if not b:
                break
            h.update(b)
    return h.hexdigest()


def ensure_raw_bucket(minio: Minio) -> None:
    if not minio.bucket_exists("raw"):
        minio.make_bucket("raw")


def source_name(item: AsiairFile, size: int | None = None, mtime: float | None = None) -> str:
    return "ASIAIR SMB" \
        + (f" | target={item.target_name}" if item.target_name else "") \
        + (f" | plan={item.plan_name}" if item.plan_name else "") \
        + (f" | type={item.frame_type}" if item.frame_type else "") \
        + (f" | size={size}" if size is not None else "") \
        + (f" | mtime={mtime}" if mtime is not None else "") \
        + f" | path={item.relative_path}"


def backend_seen_batch(cfg: Config, items: list[AsiairFile]) -> set[str]:
    paths = [item.relative_path for item in items]
    if not paths:
        return set()
    try:
        r = requests.post(
            f"{cfg.backend_url}/internal/worker/ingest/seen-batch",
            headers={"X-Worker-Token": cfg.worker_token},
            json={"sourcePaths": paths},
            timeout=30,
        )
        if r.status_code != 200:
            LOG.warning("ASIAIR preflight failed status=%s paths=%s", r.status_code, len(paths))
            return set()
        return set(r.json().get("seenPaths") or [])
    except Exception as exc:
        LOG.warning("ASIAIR preflight unavailable paths=%s: %s", len(paths), exc)
        return set()


def connect_smb(cfg: Config) -> None:
    register_session(
        cfg.asiair_host,
        username=cfg.asiair_username,
        password=cfg.asiair_password,
        require_signing=cfg.asiair_smb_require_signing,
    )


def import_file(cfg: Config, minio: Minio, imported: set[str], known_paths: set[str], tracker: StableTracker, item: AsiairFile, now_ts: float) -> None:
    remote = item.remote
    st = lstat(remote)
    key = remote.replace("\\", "/")
    if key in imported:
        LOG.debug("Skipping already imported FITS path=%s", item.relative_path)
        return

    if item.relative_path in known_paths:
        imported.add(key)
        LOG.debug("Skipping backend-known ASIAIR FITS path=%s", item.relative_path)
        return

    if not tracker.is_stable(key, st.st_size, st.st_mtime, now_ts):
        LOG.info("Waiting for stable FITS file path=%s size=%s mtime=%s", item.relative_path, st.st_size, st.st_mtime)
        return

    local_path = None
    try:
        with tempfile.NamedTemporaryFile(delete=False) as tmp:
            local_path = tmp.name
            LOG.info("Downloading ASIAIR FITS path=%s size=%s target=%s type=%s", item.relative_path, st.st_size, item.target_name, item.frame_type)
            with open_file(remote, mode="rb") as rf:
                while True:
                    chunk = rf.read(1024 * 1024)
                    if not chunk:
                        break
                    tmp.write(chunk)

        checksum = sha256_file(local_path)
        storage_key = f"{checksum}-{item.filename}"
        bytes_written = os.path.getsize(local_path)
        with open(local_path, "rb") as f:
            minio.put_object("raw", storage_key, data=f, length=bytes_written, content_type="application/fits")
        LOG.info("Stored ASIAIR FITS path=%s storageKey=%s checksum=%s bytes=%s", item.relative_path, storage_key, checksum, bytes_written)

        payload = {
            "originalFilename": item.filename,
            "storageKey": storage_key,
            "checksum": checksum,
            "sourceName": source_name(item, st.st_size, st.st_mtime),
            "frameType": item.frame_type,
        }
        r = requests.post(
            f"{cfg.backend_url}/internal/worker/ingest/register",
            headers={"X-Worker-Token": cfg.worker_token},
            json=payload,
            timeout=30,
        )
        if r.status_code in (200, 201, 409):
            imported.add(key)
            LOG.info("Registered ASIAIR FITS path=%s target=%s type=%s status=%s", item.relative_path, item.target_name, item.frame_type, r.status_code)
        else:
            LOG.warning("Import register failed for %s status=%s", remote, r.status_code)
    finally:
        if local_path:
            try:
                os.unlink(local_path)
            except Exception:
                pass


def run() -> None:
    cfg = Config()
    if not cfg.enabled:
        LOG.info("ASIAIR ingest worker disabled (ASIAIR_ENABLED=false)")
        while True:
            time.sleep(300)

    ClientConfig(require_secure_negotiate=cfg.asiair_smb_require_secure_negotiate)

    root = smb_url(cfg)
    LOG.info(
        "Starting ASIAIR SMB polling host=%s share=%s base=%s maxDepth=%s requireSigning=%s requireSecureNegotiate=%s",
        cfg.asiair_host,
        cfg.asiair_share,
        cfg.asiair_base_path,
        cfg.max_scan_depth,
        cfg.asiair_smb_require_signing,
        cfg.asiair_smb_require_secure_negotiate,
    )

    tracker = StableTracker(cfg.file_stable_seconds)
    imported = set()
    minio = Minio(cfg.minio_endpoint, access_key=cfg.minio_access_key, secret_key=cfg.minio_secret_key, secure=False)

    while True:
        now_ts = time.time()
        try:
            ensure_raw_bucket(minio)
            connect_smb(cfg)
            files, stats = collect_fits(root, cfg.max_scan_depth)
            known_paths = backend_seen_batch(cfg, files)
            LOG.info(
                "ASIAIR SMB scan complete dirs=%s skippedDirs=%s paths=%s fits=%s known=%s",
                stats.dirs_seen,
                stats.dirs_skipped,
                stats.paths_seen,
                stats.fits_candidates,
                len(known_paths),
            )
            for item in files:
                import_file(cfg, minio, imported, known_paths, tracker, item, now_ts)
        except Exception as exc:
            LOG.warning("ASIAIR SMB poll unavailable; retrying in %ss: %s", cfg.poll_interval_seconds, exc)

        time.sleep(cfg.poll_interval_seconds)


if __name__ == "__main__":
    run()
