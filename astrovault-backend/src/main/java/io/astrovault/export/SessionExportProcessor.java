package io.astrovault.export;

import io.astrovault.domain.Frame;
import io.astrovault.domain.FrameType;
import io.astrovault.domain.ImagingSession;
import io.astrovault.domain.JobStatus;
import io.astrovault.domain.JobType;
import io.astrovault.domain.ProcessingJob;
import io.astrovault.storage.StorageService;
import io.quarkus.narayana.jta.QuarkusTransaction;
import io.quarkus.runtime.ShutdownEvent;
import io.quarkus.scheduler.Scheduled;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.event.Observes;
import jakarta.inject.Inject;

import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.List;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.stream.Collectors;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

@ApplicationScoped
public class SessionExportProcessor {

    private final AtomicBoolean shuttingDown = new AtomicBoolean(false);

    @Inject
    StorageService storageService;

    void onShutdown(@Observes ShutdownEvent event) {
        shuttingDown.set(true);
    }

    @Scheduled(every = "5s")
    void processPendingExports() {
        if (shuttingDown.get()) {
            return;
        }
        List<Long> jobIds = QuarkusTransaction.requiringNew().call(this::pendingJobIds);
        for (Long jobId : jobIds) {
            if (shuttingDown.get()) {
                return;
            }
            run(jobId);
        }
    }

    private void run(Long jobId) {
        try {
            ExportPlan plan = QuarkusTransaction.requiringNew().call(() -> preparePlan(jobId));
            Path tempZip = Files.createTempFile("astrovault-session-export-" + plan.sessionId + "-", ".zip");
            try {
                try (ZipOutputStream zip = new ZipOutputStream(Files.newOutputStream(tempZip), StandardCharsets.UTF_8)) {
                    Map<String, Integer> usedNames = new HashMap<>();
                    for (ExportFrame f : plan.frames) {
                        String folder = folderFor(f.frameType);
                        String baseName = folder + "/session-" + (f.sessionId == null ? "unknown" : f.sessionId) + "/" + f.originalFilename;
                        int n = usedNames.getOrDefault(baseName, 0);
                        usedNames.put(baseName, n + 1);
                        String entryName = n == 0 ? baseName : withSuffix(baseName, n);
                        zip.putNextEntry(new ZipEntry(entryName));
                        try (InputStream raw = storageService.getStream("raw", f.storageKey)) {
                            raw.transferTo(zip);
                        }
                        zip.closeEntry();
                    }
                    zip.putNextEntry(new ZipEntry("Metadata/manifest.json"));
                    zip.write(plan.manifest.getBytes(StandardCharsets.UTF_8));
                    zip.closeEntry();
                }
                String key = "export-session-" + plan.sessionId + "-job-" + plan.jobId + ".zip";
                try (InputStream export = Files.newInputStream(tempZip)) {
                    storageService.put("exports", key, export, Files.size(tempZip), "application/zip");
                }
                QuarkusTransaction.requiringNew().run(() -> completeJob(plan.jobId, key));
            } finally {
                Files.deleteIfExists(tempZip);
            }
        } catch (Exception e) {
            QuarkusTransaction.requiringNew().run(() -> failJob(jobId, e.getMessage()));
        }
    }

    List<Long> pendingJobIds() {
        List<ProcessingJob> jobs = ProcessingJob.list("type = ?1 and status = ?2", JobType.SESSION_EXPORT, JobStatus.PENDING);
        return jobs.stream().map(j -> j.id).collect(Collectors.toList());
    }

    ExportPlan preparePlan(Long jobId) {
        ProcessingJob job = ProcessingJob.findById(jobId);
        if (job == null || job.type != JobType.SESSION_EXPORT) {
            throw new IllegalArgumentException("Export job not found");
        }
        if (job.status != JobStatus.PENDING) {
            throw new IllegalStateException("Export job is not pending");
        }
        job.status = JobStatus.RUNNING;
        job.startedAt = Instant.now();
        ImagingSession session = ImagingSession.findById(job.sessionId);
        if (session == null) {
            throw new IllegalArgumentException("Session not found");
        }
        List<ImagingSession> groupedSessions = (session.logicalGroupKey == null || session.logicalGroupKey.isBlank())
                ? List.of(session)
                : ImagingSession.list("logicalGroupKey", session.logicalGroupKey);
        List<Long> sessionIds = groupedSessions.stream().map(s -> s.id).collect(Collectors.toList());
        List<Frame> frames = Frame.list("session.id in ?1", sessionIds);
        String manifest = buildManifest(session, groupedSessions, frames);
        List<ExportFrame> exportFrames = frames.stream()
                .map(f -> new ExportFrame(f.storageKey, f.frameType == null ? FrameType.LIGHT : f.frameType, f.session == null ? null : f.session.id, f.originalFilename))
                .collect(Collectors.toList());
        return new ExportPlan(job.id, session.id, exportFrames, manifest);
    }

    void completeJob(Long jobId, String key) {
        ProcessingJob job = ProcessingJob.findById(jobId);
        if (job == null) return;
        job.resultStorageKey = key;
        job.status = JobStatus.COMPLETED;
        job.finishedAt = Instant.now();
        job.errorMessage = null;
    }

    void failJob(Long jobId, String message) {
        ProcessingJob job = ProcessingJob.findById(jobId);
        if (job == null) return;
        job.status = JobStatus.FAILED;
        job.finishedAt = Instant.now();
        job.errorMessage = message;
    }

    private record ExportPlan(Long jobId, Long sessionId, List<ExportFrame> frames, String manifest) {}
    private record ExportFrame(String storageKey, FrameType frameType, Long sessionId, String originalFilename) {}

    private String folderFor(FrameType type) {
        return switch (type) {
            case LIGHT -> "Lights";
            case DARK -> "Darks";
            case FLAT -> "Flats";
            case DARK_FLAT -> "DarkFlats";
            case BIAS -> "Bias";
        };
    }

    private String buildManifest(ImagingSession session, List<ImagingSession> groupedSessions, List<Frame> frames) {
        StringBuilder sb = new StringBuilder();
        sb.append("{\"session\":{\"id\":").append(session.id).append(",\"notes\":\"")
                .append(session.notes == null ? "" : session.notes.replace("\"", "\\\""))
                .append("\",\"logicalGroupKey\":\"")
                .append(session.logicalGroupKey == null ? "" : session.logicalGroupKey.replace("\"", "\\\""))
                .append("\"},\"target\":{\"id\":").append(session.target == null ? "null" : session.target.id)
                .append(",\"name\":\"")
                .append(session.target == null || session.target.name == null ? "" : session.target.name.replace("\"", "\\\""))
                .append("\"},\"groupedSessions\":[");
        for (int i = 0; i < groupedSessions.size(); i++) {
            ImagingSession gs = groupedSessions.get(i);
            sb.append("{\"id\":").append(gs.id).append(",\"notes\":\"")
                    .append(gs.notes == null ? "" : gs.notes.replace("\"", "\\\""))
                    .append("\"}");
            if (i < groupedSessions.size() - 1) sb.append(",");
        }
        sb.append("],\"frames\":[");
        for (int i = 0; i < frames.size(); i++) {
            Frame f = frames.get(i);
            String md = f.metadata == null ? "{}" : f.metadata;
            sb.append("{\"id\":").append(f.id)
                    .append(",\"filename\":\"").append(f.originalFilename.replace("\"", "\\\""))
                    .append("\",\"frameType\":\"").append(f.frameType)
                    .append("\",\"checksum\":\"").append(f.checksum)
                    .append("\",\"sourceName\":\"").append(f.sourceName == null ? "" : f.sourceName.replace("\"", "\\\""))
                    .append("\",\"metadata\":").append(md).append("}");
            if (i < frames.size() - 1) sb.append(",");
        }
        sb.append("]}");
        return sb.toString();
    }

    private String withSuffix(String path, int copyIndex) {
        int slash = path.lastIndexOf('/');
        int dot = path.lastIndexOf('.');
        if (dot > slash) {
            return path.substring(0, dot) + "-" + copyIndex + path.substring(dot);
        }
        return path + "-" + copyIndex;
    }
}
