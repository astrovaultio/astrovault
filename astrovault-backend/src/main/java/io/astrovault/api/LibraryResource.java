package io.astrovault.api;

import io.astrovault.domain.Frame;
import io.astrovault.domain.ImagingSession;
import io.astrovault.domain.JobStatus;
import io.astrovault.domain.JobType;
import io.astrovault.domain.ProcessedAsset;
import io.astrovault.domain.ProcessingJob;
import io.astrovault.domain.Target;
import io.astrovault.domain.TargetEnrichment;
import io.astrovault.jobs.JobQueue;
import io.astrovault.storage.StorageService;
import jakarta.annotation.security.RolesAllowed;
import jakarta.inject.Inject;
import jakarta.transaction.Transactional;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import java.time.Instant;
import java.util.Comparator;
import java.util.List;

@Path("/api")
@Produces(MediaType.APPLICATION_JSON)
@RolesAllowed({"ADMIN", "USER", "VIEWER"})
public class LibraryResource {

    @Inject
    StorageService storageService;

    @Inject
    JobQueue jobQueue;

    public record Dashboard(
            long sessionCount,
            long frameCount,
            long targetCount,
            long processedAssetCount,
            long integrationTime,
            List<Frame> recentImports,
            List<ImagingSession> recentSessions,
            List<ProcessedAsset> recentProcessedAssets,
            List<ProcessingJob> activeJobs
    ) {}

    public record TargetStats(long sessions, long frames, long integrationTime, long results) {}
    public record TargetTimelineItem(Long sessionId, Instant startTime, Instant endTime, Long integrationTime, long frameCount, boolean hasResult) {}
    public record TargetDetail(
            Target target,
            TargetStats stats,
            ProcessedAsset latestResult,
            TargetEnrichment enrichment,
            List<TargetTimelineItem> timeline,
            List<ImagingSession> sessions,
            List<Frame> frames,
            List<ProcessedAsset> results
    ) {}

    @GET
    @Path("/dashboard")
    public Dashboard dashboard() {
        List<ImagingSession> recentSessions = ImagingSession.<ImagingSession>find("order by id desc").page(0, 5).list();
        attachTargetEnrichment(recentSessions);
        return new Dashboard(
                ImagingSession.count(),
                Frame.count(),
                Target.count(),
                ProcessedAsset.count(),
                ImagingSession.<ImagingSession>listAll().stream().mapToLong(s -> s.totalIntegrationTime == null ? 0L : s.totalIntegrationTime).sum(),
                Frame.<Frame>find("order by id desc").page(0, 10).list(),
                recentSessions,
                ProcessedAsset.<ProcessedAsset>find("order by id desc").page(0, 5).list(),
                ProcessingJob.list("status in ?1", List.of(JobStatus.PENDING, JobStatus.RUNNING))
        );
    }

    @GET
    @Path("/storage/usage")
    public StorageService.StorageUsage storageUsage() {
        return storageService.usage();
    }

    @GET @Path("/targets") public List<Target> targets() { return Target.listAll(); }

    @GET
    @Path("/targets/{id}/detail")
    @Transactional
    public Response targetDetail(@PathParam("id") Long id) {
        Target target = Target.findById(id);
        if (target == null) {
            return Response.status(Response.Status.NOT_FOUND).build();
        }
        List<ImagingSession> sessions = ImagingSession.<ImagingSession>list("target.id = ?1 order by startTime desc nulls last, id desc", id);
        List<Long> sessionIds = sessions.stream().map(s -> s.id).toList();
        List<Frame> frames = sessionIds.isEmpty() ? List.of() : Frame.list("session.id in ?1", sessionIds);
        List<ProcessedAsset> results = ProcessedAsset.<ProcessedAsset>list("target.id = ?1 order by createdAt desc nulls last, id desc", id);
        ProcessedAsset latestResult = results.stream()
                .max(Comparator.comparing((ProcessedAsset a) -> a.createdAt == null ? Instant.EPOCH : a.createdAt).thenComparing(a -> a.id))
                .orElse(null);
        TargetEnrichment enrichment = TargetEnrichment.find("target.id", id).firstResult();
        if (enrichment == null) {
            queueTargetEnrichment(id);
        }
        List<TargetTimelineItem> timeline = sessions.stream()
                .map(session -> new TargetTimelineItem(
                        session.id,
                        session.startTime,
                        session.endTime,
                        session.totalIntegrationTime,
                        frames.stream().filter(f -> f.session != null && session.id.equals(f.session.id)).count(),
                        results.stream().anyMatch(a -> a.session != null && session.id.equals(a.session.id))
                ))
                .toList();
        long integration = sessions.stream().mapToLong(s -> s.totalIntegrationTime == null ? 0L : s.totalIntegrationTime).sum();
        return Response.ok(new TargetDetail(
                target,
                new TargetStats(sessions.size(), frames.size(), integration, results.size()),
                latestResult,
                enrichment,
                timeline,
                sessions,
                frames,
                results
        )).build();
    }

    @POST
    @Path("/targets/{id}/enrichment/refresh")
    @Transactional
    @RolesAllowed({"ADMIN", "USER"})
    public Response refreshTargetEnrichment(@PathParam("id") Long id) {
        Target target = Target.findById(id);
        if (target == null) {
            return Response.status(Response.Status.NOT_FOUND).build();
        }
        ProcessingJob job = queueTargetEnrichment(id);
        return Response.status(Response.Status.ACCEPTED).entity(job).build();
    }

    private ProcessingJob queueTargetEnrichment(Long targetId) {
        ProcessingJob existing = ProcessingJob.find(
                "type = ?1 and targetId = ?2 and status in ?3",
                JobType.TARGET_ENRICHMENT,
                targetId,
                List.of(JobStatus.PENDING, JobStatus.RUNNING)
        ).firstResult();
        if (existing != null) {
            return existing;
        }
        ProcessingJob job = new ProcessingJob();
        job.type = JobType.TARGET_ENRICHMENT;
        job.status = JobStatus.PENDING;
        job.createdAt = Instant.now();
        job.targetId = targetId;
        job.persistAndFlush();
        jobQueue.enqueue(job);
        return job;
    }

    @GET @Path("/sessions") public List<ImagingSession> sessions() {
        List<ImagingSession> sessions = ImagingSession.listAll();
        attachTargetEnrichment(sessions);
        return sessions;
    }
    @GET @Path("/processed-assets") public List<ProcessedAsset> processedAssets() { return ProcessedAsset.listAll(); }

    @GET
    @Path("/processed-assets/{id}/preview")
    public Response previewProcessedAsset(@PathParam("id") Long id) {
        ProcessedAsset asset = ProcessedAsset.findById(id);
        if (asset == null || asset.storageKey == null || asset.storageKey.isBlank()) {
            return Response.status(Response.Status.NOT_FOUND).build();
        }
        byte[] content = storageService.get("processed", asset.storageKey);
        return Response.ok(content, contentTypeFor(asset.storageKey)).build();
    }

    @GET
    @Path("/processed-assets/{id}/download")
    public Response downloadProcessedAsset(@PathParam("id") Long id) {
        ProcessedAsset asset = ProcessedAsset.findById(id);
        if (asset == null || asset.storageKey == null || asset.storageKey.isBlank()) {
            return Response.status(Response.Status.NOT_FOUND).build();
        }
        byte[] content = storageService.get("processed", asset.storageKey);
        return Response.ok(content, contentTypeFor(asset.storageKey))
                .header("Content-Disposition", "attachment; filename=\"" + fileNameFor(asset.storageKey) + "\"")
                .build();
    }

    @POST
    @Path("/processed-assets")
    @Transactional
    @RolesAllowed({"ADMIN", "USER"})
    public ProcessedAsset addProcessedAsset(ProcessedAsset asset) {
        asset.createdAt = Instant.now();
        asset.persist();
        return asset;
    }

    private String contentTypeFor(String key) {
        String lower = key.toLowerCase();
        if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
        if (lower.endsWith(".png")) return "image/png";
        if (lower.endsWith(".webp")) return "image/webp";
        if (lower.endsWith(".gif")) return "image/gif";
        if (lower.endsWith(".tif") || lower.endsWith(".tiff")) return "image/tiff";
        if (lower.endsWith(".fits") || lower.endsWith(".fit")) return "application/fits";
        return MediaType.APPLICATION_OCTET_STREAM;
    }

    private String fileNameFor(String key) {
        int slash = key.lastIndexOf('/');
        return (slash >= 0 ? key.substring(slash + 1) : key).replace("\"", "");
    }

    private void attachTargetEnrichment(List<ImagingSession> sessions) {
        for (ImagingSession session : sessions) {
            if (session.target == null || session.target.id == null) {
                continue;
            }
            session.targetEnrichment = TargetEnrichment.find("target.id", session.target.id).firstResult();
        }
    }

}
