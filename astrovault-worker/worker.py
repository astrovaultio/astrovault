import json
import logging
import os
import re
import time
import csv
from dataclasses import dataclass
from functools import lru_cache
from io import BytesIO, StringIO
from urllib.parse import quote

import numpy as np
import pika
import requests
from astropy.io import fits
from minio import Minio
from PIL import Image

logging.basicConfig(
    level=os.getenv("ASTROVAULT_LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s %(levelname)s [worker] %(message)s",
)
LOG = logging.getLogger("astrovault.worker")
DEFAULT_OPENNGC_URL = "https://raw.githubusercontent.com/mattiaverga/OpenNGC/refs/heads/master/database_files/NGC.csv"
WIKIPEDIA_USER_AGENT = os.getenv(
    "ASTROVAULT_WIKIPEDIA_USER_AGENT",
    "AstroVault/0.1 target-enrichment (https://github.com/Eluminat001/astrovault)",
)
KNOWN_NAMED_TARGETS = {
    "MARKARIANSCHAIN": "Markarian's Chain",
}


class PermanentJobError(Exception):
    pass


def is_missing_raw_object_error(exc: Exception) -> bool:
    return exc.__class__.__name__ == "S3Error" and getattr(exc, "code", None) == "NoSuchKey"


@dataclass
class Config:
    rabbitmq_host: str = os.getenv("ASTROVAULT_RABBITMQ_HOST", "localhost")
    backend_url: str = os.getenv("ASTROVAULT_BACKEND_URL", "http://localhost:8080")
    worker_token: str = os.getenv("ASTROVAULT_WORKER_TOKEN", "worker-token-dev")
    minio_endpoint: str = os.getenv("ASTROVAULT_MINIO_ENDPOINT", "localhost:9000")
    minio_access_key: str = os.getenv("ASTROVAULT_MINIO_ACCESS_KEY", "astrovault")
    minio_secret_key: str = os.getenv("ASTROVAULT_MINIO_SECRET_KEY", "astrovault123")
    minio_secure: bool = os.getenv("ASTROVAULT_MINIO_SECURE", "false").lower() == "true"
    technical_retry_count: int = int(os.getenv("ASTROVAULT_WORKER_TECH_RETRIES", "3"))
    technical_retry_delay_seconds: float = float(os.getenv("ASTROVAULT_WORKER_TECH_RETRY_DELAY_SECONDS", "2"))
    openngc_url: str = os.getenv("ASTROVAULT_OPENNGC_URL", DEFAULT_OPENNGC_URL)
    wikipedia_enabled: bool = os.getenv("ASTROVAULT_WIKIPEDIA_ENRICHMENT_ENABLED", "false").lower() == "true"


def normalize_frame_type(value: str | None) -> str:
    image_type = (value or "").upper().replace("-", "_").replace(" ", "_")
    compact = image_type.replace("_", "")
    if "DARK_FLAT" in image_type or "DARKFLAT" in compact:
        return "DARK_FLAT"
    if "DARK" in image_type:
        return "DARK"
    if "FLAT" in image_type:
        return "FLAT"
    if "BIAS" in image_type:
        return "BIAS"
    return "LIGHT"


def parse_filename_metadata(original_filename: str | None) -> dict:
    name = os.path.basename(original_filename or "")
    stem = re.sub(r"\.(fits?|fts)$", "", name, flags=re.IGNORECASE)
    parts = [p for p in re.split(r"[_\s]+", stem) if p]
    frame_type = None
    object_name = None
    for idx, part in enumerate(parts):
        candidate = normalize_frame_type(part)
        if candidate != "LIGHT" or part.upper() == "LIGHT":
            frame_type = candidate
            if idx + 1 < len(parts):
                nxt = parts[idx + 1]
                if not re.match(r"^(\d+(?:\.\d+)?s|bin\d+|gain\d+|iso\d+|\d{8}-\d{6})$", nxt, re.IGNORECASE):
                    object_name = nxt
            break
    date_obs = None
    match = re.search(r"(20\d{6})[-_]?([0-2]\d[0-5]\d[0-5]\d)", stem)
    if match:
        date, clock = match.groups()
        date_obs = f"{date[0:4]}-{date[4:6]}-{date[6:8]}T{clock[0:2]}:{clock[2:4]}:{clock[4:6]}"
    return {"object": object_name, "dateObs": date_obs, "imageType": frame_type}


def parse_source_metadata(source_name: str | None) -> dict:
    target = None
    if source_name:
        match = re.search(r"(?:^|\|)\s*target=([^|]+)", source_name)
        if match:
            target = match.group(1).strip() or None
    return {"object": target}


def normalize_target_name(value: str | None) -> str:
    if not value:
        return ""
    trimmed = re.sub(r"\s+", " ", value.strip().replace("_", " ").replace("-", " "))
    if not trimmed:
        return ""
    alias = KNOWN_NAMED_TARGETS.get(catalog_key(trimmed))
    if alias:
        return alias
    messier = re.match(r"^(?:MESSIER\s*)?M\s*0*(\d+)$", trimmed, re.IGNORECASE)
    if messier:
        return f"M{int(messier.group(1))}"
    catalog = re.match(r"^(NGC|IC)\s*0*(\d+)$", trimmed, re.IGNORECASE)
    if catalog:
        return f"{catalog.group(1).upper()}{int(catalog.group(2))}"
    return trimmed


def catalog_key(value: str | None) -> str:
    return re.sub(r"\s+", "", value or "").upper()


def normalized_catalog_key(value: str | None) -> str:
    return catalog_key(normalize_target_name(value))


def is_known_named_target(value: str | None) -> bool:
    return catalog_key(value) in KNOWN_NAMED_TARGETS or normalized_catalog_key(value) in KNOWN_NAMED_TARGETS


def strip_leading_zeros(value: str | None) -> str | None:
    if value is None or not str(value).strip():
        return None
    try:
        return str(int(str(value).strip()))
    except ValueError:
        return str(value).strip()


def first_present(row: dict, *names: str) -> str | None:
    for name in names:
        value = row.get(name)
        if value is not None and str(value).strip():
            return str(value).strip()
    return None


def parse_number(value: str | None) -> float | None:
    if value is None or not str(value).strip():
        return None
    try:
        return float(str(value).strip())
    except ValueError:
        return None


def parse_sexagesimal(value: str | None, *, hours: bool) -> float | None:
    if value is None or not str(value).strip():
        return None
    text = str(value).strip()
    parts = text.split(":")
    if len(parts) != 3:
        return parse_number(value)
    try:
        first = float(parts[0])
        sign = -1 if text.startswith("-") else 1
        total = abs(first) + (float(parts[1]) / 60.0) + (float(parts[2]) / 3600.0)
        return sign * total * (15.0 if hours else 1.0)
    except ValueError:
        return None


def catalog_name(row: dict) -> str | None:
    messier = strip_leading_zeros(row.get("M"))
    if messier:
        return f"M{messier}"
    ngc = strip_leading_zeros(row.get("NGC"))
    if ngc:
        return f"NGC{ngc}"
    ic = strip_leading_zeros(row.get("IC"))
    if ic:
        return f"IC{ic}"
    return None


def catalog_ids(row: dict) -> str | None:
    values = []
    for prefix in ("M", "NGC", "IC"):
        identifier = strip_leading_zeros(row.get(prefix))
        if identifier:
            values.append(f"{prefix}{identifier}")
    return ", ".join(values) or None


def row_to_enrichment(row: dict, source_reference: str) -> dict:
    canonical = first_present(row, "Name", "name") or catalog_name(row)
    return {
        "canonicalName": canonical,
        "objectType": first_present(row, "Type", "type"),
        "catalogIds": catalog_ids(row),
        "constellation": first_present(row, "Const", "Constellation", "constellation"),
        "ra": parse_sexagesimal(first_present(row, "RA", "ra"), hours=True),
        "dec": parse_sexagesimal(first_present(row, "Dec", "DEC", "dec"), hours=False),
        "magnitude": parse_number(first_present(row, "V-Mag", "B-Mag", "J-Mag", "Mag", "mag", "magnitude")),
        "apparentSize": first_present(row, "MajAx", "Size", "apparentSize"),
        "distance": None,
        "description": None,
        "source": "OpenNGC",
        "sourceReference": source_reference,
    }


@lru_cache(maxsize=4)
def load_openngc_catalog(url: str) -> dict:
    if not url:
        return {}
    rows = {}
    try:
        response = requests.get(url, headers={"Accept": "text/csv,*/*"}, timeout=20)
        response.raise_for_status()
        sample = response.text[:4096]
        try:
            dialect = csv.Sniffer().sniff(sample, delimiters=",;")
        except csv.Error:
            dialect = csv.excel()
            dialect.delimiter = ";"
        for row in csv.DictReader(StringIO(response.text), dialect=dialect):
            data = row_to_enrichment(row, url)
            canonical = data.get("canonicalName")
            if canonical:
                rows[catalog_key(canonical)] = data
                rows[normalized_catalog_key(canonical)] = data
            for prefix in ("M", "NGC", "IC"):
                identifier = strip_leading_zeros(row.get(prefix))
                if identifier:
                    rows[catalog_key(f"{prefix}{identifier}")] = data
        LOG.info("OpenNGC catalog loaded url=%s lookupKeys=%s", url, len(rows))
    except Exception as exc:
        LOG.warning("Unable to load OpenNGC catalog url=%s error=%s", url, exc)
        return {}
    return rows


def wikipedia_candidates(enrichment: dict) -> list[str]:
    values = []
    canonical = enrichment.get("canonicalName")
    if canonical:
        values.append(str(canonical))
    for catalog_id in (enrichment.get("catalogIds") or "").split(","):
        value = catalog_id.strip()
        if not value:
            continue
        values.append(value)
        messier = re.match(r"^M(\d+)$", value, re.IGNORECASE)
        if messier:
            values.append(f"Messier {int(messier.group(1))}")
    deduped = []
    seen = set()
    for value in values:
        key = catalog_key(value)
        if key and key not in seen:
            seen.add(key)
            deduped.append(value)
    return deduped[:5]


def wikipedia_summary(cfg: Config, candidates: list[str]) -> tuple[str, str] | None:
    if not cfg.wikipedia_enabled or not candidates:
        LOG.debug("Wikipedia summary skipped enabled=%s candidates=%s", cfg.wikipedia_enabled, candidates)
        return None
    for candidate in candidates:
        try:
            LOG.info("Wikipedia summary lookup started candidate=%s", candidate)
            title = quote(candidate.replace(" ", "_"), safe="")
            response = requests.get(
                f"https://en.wikipedia.org/api/rest_v1/page/summary/{title}",
                headers={"Accept": "application/json", "User-Agent": WIKIPEDIA_USER_AGENT},
                timeout=10,
            )
            if response.status_code != 200:
                LOG.info("Wikipedia summary lookup returned status=%s candidate=%s", response.status_code, candidate)
                continue
            body = response.json()
            if body.get("type") == "disambiguation":
                LOG.info("Wikipedia summary skipped disambiguation candidate=%s", candidate)
                continue
            description = body.get("extract")
            source_url = (((body.get("content_urls") or {}).get("desktop") or {}).get("page"))
            if not description:
                LOG.info("Wikipedia summary lookup had no extract candidate=%s", candidate)
                continue
            LOG.info("Wikipedia summary lookup succeeded candidate=%s sourceUrl=%s", candidate, source_url)
            return description, source_url
        except Exception as exc:
            LOG.info("Wikipedia summary lookup failed candidate=%s error=%s", candidate, exc)
    return None


def enrich_target(cfg: Config, target: dict) -> dict:
    normalized = normalize_target_name(target.get("name"))
    lookup_key = catalog_key(normalized)
    LOG.info(
        "Target enrichment started targetId=%s name=%s normalized=%s openNgcConfigured=%s wikipediaEnabled=%s",
        target.get("id"),
        target.get("name"),
        normalized,
        bool(cfg.openngc_url),
        cfg.wikipedia_enabled,
    )
    enrichment = load_openngc_catalog(cfg.openngc_url).get(lookup_key)
    catalog_matched = enrichment is not None
    if enrichment is None:
        LOG.info("Target enrichment catalog miss targetId=%s lookupKey=%s", target.get("id"), lookup_key)
        enrichment = {
            "canonicalName": normalized or target.get("name"),
            "objectType": None,
            "catalogIds": None,
            "constellation": None,
            "ra": target.get("ra"),
            "dec": target.get("dec"),
            "magnitude": None,
            "apparentSize": None,
            "distance": None,
            "description": None,
            "source": "Not available",
            "sourceReference": None,
        }
    else:
        enrichment = dict(enrichment)
        LOG.info(
            "Target enrichment catalog match targetId=%s lookupKey=%s canonicalName=%s catalogIds=%s source=%s",
            target.get("id"),
            lookup_key,
            enrichment.get("canonicalName"),
            enrichment.get("catalogIds"),
            enrichment.get("source"),
        )
        enrichment["ra"] = enrichment.get("ra") if enrichment.get("ra") is not None else target.get("ra")
        enrichment["dec"] = enrichment.get("dec") if enrichment.get("dec") is not None else target.get("dec")

    allow_named_summary = is_known_named_target(target.get("name"))
    summary = wikipedia_summary(cfg, wikipedia_candidates(enrichment)) if catalog_matched or allow_named_summary else None
    if not catalog_matched and cfg.wikipedia_enabled and not allow_named_summary:
        LOG.info("Wikipedia summary skipped targetId=%s reason=catalog-miss canonicalName=%s", target.get("id"), enrichment.get("canonicalName"))
    if summary is not None:
        description, source_url = summary
        enrichment["description"] = description
        enrichment["source"] = merge_source(enrichment.get("source"), "Wikipedia summary")
        enrichment["sourceReference"] = merge_source(enrichment.get("sourceReference"), source_url)
    LOG.info(
        "Target enrichment completed targetId=%s canonicalName=%s source=%s hasDescription=%s",
        target.get("id"),
        enrichment.get("canonicalName"),
        enrichment.get("source"),
        bool(enrichment.get("description")),
    )
    return enrichment


def merge_source(left: str | None, right: str | None) -> str | None:
    if not left:
        return right
    if not right:
        return left
    if right in left:
        return left
    return f"{left}; {right}"


def extract_metadata(fits_bytes: bytes, original_filename: str | None = None, source_name: str | None = None) -> tuple[dict, str]:
    def to_jsonable(value):
        if isinstance(value, (str, int, float, bool)) or value is None:
            return value
        if isinstance(value, bytes):
            return value.decode("utf-8", errors="replace")
        if isinstance(value, (list, tuple)):
            return [to_jsonable(v) for v in value]
        if isinstance(value, dict):
            return {str(k): to_jsonable(v) for k, v in value.items()}
        try:
            return value.item()  # numpy scalar
        except Exception:
            return str(value)

    with fits.open(BytesIO(fits_bytes)) as hdul:
        header = hdul[0].header
        filename_info = parse_filename_metadata(original_filename)
        source_info = parse_source_metadata(source_name)
        header_image_type = header.get("IMAGETYP")
        image_type = header_image_type or filename_info.get("imageType") or "LIGHT"
        frame_type = normalize_frame_type(str(image_type))

        parsed = {
            "object": header.get("OBJECT") or filename_info.get("object") or source_info.get("object"),
            "dateObs": header.get("DATE-OBS") or filename_info.get("dateObs"),
            "exposureTime": header.get("EXPTIME"),
            "gain": header.get("GAIN"),
            "temperature": header.get("CCD-TEMP", header.get("SENSOR-TEMP")),
            "imageType": header_image_type or filename_info.get("imageType"),
            "filenameFallback": filename_info,
            "sourceFallback": source_info,
            "header": {k: to_jsonable(header[k]) for k in header.keys()},
        }
        return parsed, frame_type


def build_preview_images(fits_bytes: bytes) -> tuple[bytes, bytes]:
    with fits.open(BytesIO(fits_bytes)) as hdul:
        hdu = hdul[0]
        data_offset = getattr(hdu, "_data_offset", 0) or 0
        bitpix = int(hdu.header.get("BITPIX", 0) or 0)
        naxis = int(hdu.header.get("NAXIS", 0) or 0)
        if naxis > 0 and bitpix != 0:
            elements = 1
            for axis in range(1, naxis + 1):
                elements *= int(hdu.header.get(f"NAXIS{axis}", 0) or 0)
            bytes_per_value = abs(bitpix) // 8
            data_bytes = elements * bytes_per_value
            padded_data_bytes = ((data_bytes + 2879) // 2880) * 2880
            expected_size = data_offset + padded_data_bytes
            if len(fits_bytes) < expected_size:
                raise PermanentJobError(
                    f"FITS image data is incomplete: file has {len(fits_bytes)} bytes, "
                    f"header requires at least {expected_size} bytes"
                )
        try:
            data = hdu.data
        except TypeError as exc:
            if "buffer is too small" in str(exc):
                raise PermanentJobError("FITS image data is incomplete: buffer is too small for header dimensions") from exc
            raise
    if data is None:
        raise PermanentJobError("FITS does not contain primary image data")
    if isinstance(data, np.recarray) or data.dtype.fields is not None:
        raise PermanentJobError("FITS primary data is structured/record data; preview requires image array")
    if data.ndim < 2:
        raise PermanentJobError(f"FITS image has invalid dimensions: {data.ndim}")
    data = np.squeeze(data)

    def stretch_channel(channel: np.ndarray) -> np.ndarray:
        channel = channel.astype(np.float32)
        channel = np.nan_to_num(channel)
        finite = channel[np.isfinite(channel)]
        if finite.size == 0:
            return np.zeros(channel.shape, dtype=np.uint8)
        if finite.size > 1_000_000:
            finite = finite[:: max(1, finite.size // 1_000_000)]
        p_low, p_high = np.percentile(finite, [0.1, 99.8])
        median = float(np.median(finite))
        mad = float(np.median(np.abs(finite - median)))
        black = max(float(p_low), median - 2.5 * 1.4826 * mad)
        white = float(p_high)
        if white <= black:
            black, white = np.percentile(finite, [1, 99])
        if white <= black:
            white = black + 1.0
        normalized = np.clip((channel - black) / (white - black), 0, 1)
        stretched = np.arcsinh(normalized * 8.0) / np.arcsinh(8.0)
        return (np.power(stretched, 1.25) * 255).astype(np.uint8)

    if data.ndim == 2:
        img = Image.fromarray(stretch_channel(data), mode="L").convert("RGB")
    elif data.ndim == 3:
        channel_axes = [axis for axis, size in enumerate(data.shape) if size in (3, 4)]
        if channel_axes:
            rgb = np.moveaxis(data, channel_axes[0], -1)[..., :3]
            stretched = np.dstack([stretch_channel(rgb[..., idx]) for idx in range(3)])
            img = Image.fromarray(stretched, mode="RGB")
        else:
            LOG.warning("FITS preview received 3D cube shape=%s; using first plane", data.shape)
            img = Image.fromarray(stretch_channel(data[0]), mode="L").convert("RGB")
    else:
        raise PermanentJobError(f"FITS preview supports 2D images or RGB-like 3D arrays, got ndim={data.ndim}")

    preview = img.copy()
    preview.thumbnail((1600, 1600))
    thumb = img.copy()
    thumb.thumbnail((320, 320))

    preview_io = BytesIO()
    thumb_io = BytesIO()
    preview.save(preview_io, format="JPEG", quality=90)
    thumb.save(thumb_io, format="JPEG", quality=85)
    return preview_io.getvalue(), thumb_io.getvalue()


def set_job_status(cfg: Config, job_id: int, status: str, error_message: str | None = None) -> None:
    LOG.debug("Updating job status id=%s status=%s", job_id, status)
    requests.post(
        f"{cfg.backend_url}/internal/worker/jobs/{job_id}",
        headers={"X-Worker-Token": cfg.worker_token},
        json={"status": status, "errorMessage": error_message},
        timeout=20,
    ).raise_for_status()


def backend_json(response: requests.Response, label: str) -> dict:
    response.raise_for_status()
    try:
        return response.json()
    except ValueError as exc:
        snippet = response.text[:300].replace("\n", " ")
        raise RuntimeError(
            f"Backend returned non-JSON for {label}: status={response.status_code} content-type={response.headers.get('Content-Type')} body={snippet!r}"
        ) from exc


def process_job(cfg: Config, minio_client: Minio, job: dict) -> None:
    job_id = int(job["id"])
    job_type = job["type"]
    frame_id = int(job["frameId"]) if job.get("frameId") is not None else None
    target_id = int(job["targetId"]) if job.get("targetId") is not None else None
    LOG.info("Processing job id=%s type=%s frameId=%s targetId=%s", job_id, job_type, frame_id, target_id)
    try:
        current = backend_json(requests.get(
            f"{cfg.backend_url}/internal/worker/jobs/{job_id}",
            headers={"X-Worker-Token": cfg.worker_token},
            timeout=20,
        ), f"job {job_id}")
        if current.get("status") in ("COMPLETED", "FAILED", "CANCELLED"):
            LOG.warning("Skipping already finished job id=%s status=%s", job_id, current.get("status"))
            return
        set_job_status(cfg, job_id, "RUNNING")
        if job_type == "TARGET_ENRICHMENT":
            if target_id is None:
                raise PermanentJobError(f"Target enrichment job {job_id} has no targetId")
            LOG.info("Target enrichment job loading target jobId=%s targetId=%s", job_id, target_id)
            target = backend_json(requests.get(
                f"{cfg.backend_url}/internal/worker/targets/{target_id}",
                headers={"X-Worker-Token": cfg.worker_token},
                timeout=20,
            ), f"target {target_id}")
            LOG.info("Target enrichment job loaded target jobId=%s targetId=%s name=%s", job_id, target_id, target.get("name"))
            enrichment = enrich_target(cfg, target)
            LOG.info(
                "Target enrichment callback posting jobId=%s targetId=%s canonicalName=%s source=%s",
                job_id,
                target_id,
                enrichment.get("canonicalName"),
                enrichment.get("source"),
            )
            requests.post(
                f"{cfg.backend_url}/internal/worker/targets/{target_id}/enrichment",
                headers={"X-Worker-Token": cfg.worker_token},
                json=enrichment,
                timeout=20,
            ).raise_for_status()
            LOG.info("Target enrichment callback succeeded jobId=%s targetId=%s source=%s", job_id, target_id, enrichment.get("source"))
            set_job_status(cfg, job_id, "COMPLETED")
            LOG.info("Job completed id=%s", job_id)
            return

        if frame_id is None:
            raise PermanentJobError(f"Frame job {job_id} has no frameId")
        frame = backend_json(requests.get(
            f"{cfg.backend_url}/internal/worker/frames/{frame_id}",
            headers={"X-Worker-Token": cfg.worker_token},
            timeout=20,
        ), f"frame {frame_id}")
        LOG.debug("Loaded frame worker view id=%s storageKey=%s", frame.get("id"), frame.get("storageKey"))
        storage_key = frame.get("storageKey")
        if not storage_key:
            raise PermanentJobError(f"Frame {frame_id} has no raw storage key")
        try:
            raw = minio_client.get_object("raw", storage_key).read()
        except Exception as exc:
            if is_missing_raw_object_error(exc):
                raise PermanentJobError(f"Raw object is missing from bucket=raw key={storage_key}") from exc
            raise
        LOG.debug("Fetched raw FITS bytes frameId=%s size=%s", frame_id, len(raw))

        if job_type == "METADATA_EXTRACTION":
            LOG.info("Starting metadata extraction frameId=%s", frame_id)
            metadata, frame_type = extract_metadata(raw, frame.get("originalFilename"), frame.get("sourceName"))
            requests.post(
                f"{cfg.backend_url}/internal/worker/frames/{frame_id}/metadata",
                headers={"X-Worker-Token": cfg.worker_token},
                json={"metadata": json.dumps(metadata), "frameType": frame_type},
                timeout=20,
            ).raise_for_status()
            LOG.info("Metadata callback succeeded frameId=%s frameType=%s", frame_id, frame_type)
        elif job_type == "PREVIEW_GENERATION":
            LOG.info("Starting preview generation frameId=%s", frame_id)
            preview, thumb = build_preview_images(raw)
            preview_key = f"{frame['checksum']}.jpg"
            thumb_key = f"{frame['checksum']}-thumb.jpg"
            minio_client.put_object("previews", preview_key, BytesIO(preview), len(preview), content_type="image/jpeg")
            minio_client.put_object("thumbnails", thumb_key, BytesIO(thumb), len(thumb), content_type="image/jpeg")
            requests.post(
                f"{cfg.backend_url}/internal/worker/frames/{frame_id}/previews",
                headers={"X-Worker-Token": cfg.worker_token},
                json={"previewStorageKey": preview_key, "thumbnailStorageKey": thumb_key},
                timeout=20,
            ).raise_for_status()
            LOG.info("Preview callback succeeded frameId=%s preview=%s thumb=%s", frame_id, preview_key, thumb_key)

        set_job_status(cfg, job_id, "COMPLETED")
        LOG.info("Job completed id=%s", job_id)
    except PermanentJobError as exc:
        LOG.error("Job permanently failed id=%s type=%s frameId=%s targetId=%s error=%s", job_id, job_type, frame_id, target_id, exc, exc_info=True)
        try:
            set_job_status(cfg, job_id, "FAILED", str(exc))
        except Exception as status_exc:
            LOG.critical("Unable to report FAILED status jobId=%s error=%s", job_id, status_exc, exc_info=True)
            raise status_exc from exc
        raise
    except Exception as exc:
        LOG.error("Job transient failure id=%s type=%s frameId=%s targetId=%s error=%s", job_id, job_type, frame_id, target_id, exc, exc_info=True)
        raise


def run() -> None:
    cfg = Config()
    LOG.info("Worker startup backend=%s rabbitmq=%s minio=%s", cfg.backend_url, cfg.rabbitmq_host, cfg.minio_endpoint)
    minio_client = Minio(
        cfg.minio_endpoint,
        access_key=cfg.minio_access_key,
        secret_key=cfg.minio_secret_key,
        secure=cfg.minio_secure,
    )
    for bucket in ["raw", "previews", "thumbnails"]:
        if not minio_client.bucket_exists(bucket):
            minio_client.make_bucket(bucket)
            LOG.warning("Created missing bucket %s", bucket)

    connection = None
    for attempt in range(30):
        try:
            connection = pika.BlockingConnection(pika.ConnectionParameters(host=cfg.rabbitmq_host))
            LOG.info("Connected to RabbitMQ on attempt=%s", attempt + 1)
            break
        except Exception as exc:
            LOG.warning("RabbitMQ connect attempt=%s failed: %s", attempt + 1, exc)
            time.sleep(2)
    if connection is None:
        LOG.critical("Unable to connect to RabbitMQ after retries")
        raise RuntimeError("Unable to connect to RabbitMQ")
    channel = connection.channel()
    channel.queue_declare(queue="astrovault.jobs", durable=True)

    def callback(ch, method, properties, body):
        LOG.debug("Received queue message bytes=%s", len(body))
        job = json.loads(body)
        max_attempts = max(1, cfg.technical_retry_count)
        for attempt in range(1, max_attempts + 1):
            try:
                if attempt > 1:
                    LOG.warning("Retrying job processing jobId=%s attempt=%s/%s", job.get("id"), attempt, max_attempts)
                process_job(cfg, minio_client, job)
                ch.basic_ack(delivery_tag=method.delivery_tag)
                LOG.debug("Acknowledged message jobId=%s", job.get("id"))
                return
            except Exception as exc:
                if isinstance(exc, PermanentJobError):
                    LOG.error("Permanent job error jobId=%s error=%s", job.get("id"), exc)
                    ch.basic_ack(delivery_tag=method.delivery_tag)
                    LOG.warning("Acknowledged permanently failed message jobId=%s", job.get("id"))
                    return
                if attempt >= max_attempts:
                    LOG.error(
                        "Technical retries exhausted jobId=%s attempts=%s lastError=%s; requeueing message",
                        job.get("id"),
                        max_attempts,
                        exc,
                    )
                    ch.basic_nack(delivery_tag=method.delivery_tag, requeue=True)
                    LOG.warning("Nacked transiently failed message jobId=%s requeue=true", job.get("id"))
                    return
                time.sleep(cfg.technical_retry_delay_seconds)

    channel.basic_qos(prefetch_count=1)
    channel.basic_consume(queue="astrovault.jobs", on_message_callback=callback)
    LOG.info("Worker listening for jobs")
    channel.start_consuming()


if __name__ == "__main__":
    run()
