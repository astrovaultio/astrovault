# AstroVault Phase 1 MVP

This workspace contains the three requested repositories:

- `astrovault-backend` (Quarkus + PostgreSQL + JWT)
- `astrovault-frontend` (React + TypeScript)
- `astrovault-worker` (Python worker)

Plus infrastructure orchestration via `docker-compose.yml` for Standard Mode:

- PostgreSQL
- RabbitMQ
- MinIO
- Backend
- Worker
- Frontend

## Run Standard Mode

```bash
docker compose up --build
```

Services:

- Frontend: `http://localhost:5173`
- Backend API: `http://localhost:8080`
- RabbitMQ UI: `http://localhost:15672`
- MinIO Console: `http://localhost:9001`

## Backend Notes

- Includes core domain entities for Targets, Sessions, Frames, Jobs, and ProcessedAssets.
- Includes storage abstraction:
  - `StorageService`
  - `FilesystemStorageService`
  - `MinioStorageService`
- Includes queue abstraction:
  - `JobQueue`
  - `InProcessJobQueue`
  - `RabbitMqJobQueue`
- Includes JWT login endpoint: `POST /api/auth/login`
- Includes library endpoints for dashboard, targets, sessions, frames, jobs, and processed assets.
- Includes folder ingestion scanner from `./ingest` (container path `/data/ingest`) every 5s.
- Includes ingestion endpoints:
  - `POST /api/ingestion/frames`
  - `POST /api/ingestion/scan`
- Includes worker callback endpoints protected by `X-Worker-Token` under `/internal/worker/*`.

Demo users:

- `admin` / `admin` -> `ADMIN`
- `user` / `user` -> `USER`
- `viewer` / `viewer` -> `VIEWER`

Credentials can be overridden with:

- `ASTROVAULT_AUTH_ADMIN_PASSWORD`
- `ASTROVAULT_AUTH_USER_PASSWORD`
- `ASTROVAULT_AUTH_VIEWER_PASSWORD`

## Worker Notes

- Listens to RabbitMQ queue `astrovault.jobs`
- Processes `METADATA_EXTRACTION` and `PREVIEW_GENERATION`
- Downloads raw FITS from MinIO `raw`
- Uploads preview JPEGs to `previews` and `thumbnails`
- Updates job/frame state through backend worker endpoints

## Frontend Notes

- Real login flow with JWT
- Dashboard/API-backed counts
- Frames list and frame detail with preview + parsed FITS metadata
- Jobs page with live job status list

## Vertical Slice Check

1. Start stack: `docker compose up --build`
2. Drop a `.fits` file into `./ingest`
3. Wait a few seconds for scanner + worker processing
4. Open frontend, login as `admin`, open Frames and Jobs

## Synthetic FITS Fixture

Generate a synthetic astronomy-like FITS test file and place it into `./ingest`:

```bash
python3 scripts/generate_synthetic_fits.py --output ingest/synthetic-light.fits
```

## MVP Smoke Test

Run a minimal end-to-end verification (ingest, metadata, preview, frames API, session API, export job, processed upload):

```bash
bash scripts/smoke_test.sh
```

Optional env overrides:

- `API_BASE` (default `http://localhost:8080`)
- `INGEST_FILE` (default `ingest/smoke-light.fits`)
- `POLL_SECONDS` (default `2`)
- `POLL_TRIES` (default `30`)

## GitLab CI Docker Images

GitLab CI builds and publishes Docker images on all branches and tags. The configured Git remote points to `git.sourcelan.de`, and the pipeline uses GitLab's built-in registry variables.

Published image repositories:

- `$CI_REGISTRY_IMAGE/astrovault-backend`
- `$CI_REGISTRY_IMAGE/astrovault-frontend`
- `$CI_REGISTRY_IMAGE/astrovault-worker`
- `$CI_REGISTRY_IMAGE/astrovault-asiair-ingest-worker`

Required GitLab variables:

- `CI_REGISTRY`
- `CI_REGISTRY_IMAGE`
- `CI_REGISTRY_USER`
- `CI_REGISTRY_PASSWORD`

These are provided automatically by GitLab Container Registry for normal project pipelines.

Image tags:

- `$CI_COMMIT_SHA` for every published image.
- `$CI_COMMIT_REF_SLUG` for the branch/tag name in Docker-safe form, including feature branches.
- `latest` only for `main`.
- The project version from `astrovault-backend/pom.xml` on `main`, for example `0.1.0`.
- The Git tag itself for semver release tags such as `1.2.3` or `v1.2.3`.

The pipeline does not deploy anything.

Runner requirements:

- Jobs use the runner tag `astrovault`.
- The runner must be able to run Docker commands.
- The recommended setup is Docker socket binding, not Docker-in-Docker.
- If the runner itself runs as a container, mount the host Docker socket into the runner container.

Example runner `config.toml` setting:

```toml
[[runners]]
  executor = "docker"
  [runners.docker]
    volumes = ["/var/run/docker.sock:/var/run/docker.sock", "/cache"]
```

The Docker daemon must be running on the runner host. The pipeline intentionally does not start a `docker:dind` service.

## Ingest Sources (ASIAIR mounted share)

Configure multiple ingest sources with env var `ASTROVAULT_INGEST_SOURCES` format:

`name|type|path|enabled;name2|type|path|enabled`

Types: `LOCAL_FOLDER`, `SMB_MOUNT_FOLDER`.

Example:

`ASTROVAULT_INGEST_SOURCES=LocalIngest|LOCAL_FOLDER|/data/ingest|true;ASIAIR|SMB_MOUNT_FOLDER|/data/asiair|true`

For ASIAIR SMB, mount the share on host/container and point `path` to that mounted folder.

## Next steps

1. Implement FITS metadata parsing and preview generation pipeline in worker with backend callbacks.
2. Add upload/download endpoints (session ZIP export + processed result uploads).
3. Add full API integration in frontend and role-aware auth UX.
4. Add migration tooling (Flyway/Liquibase) and complete integration tests.
