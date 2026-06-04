package io.astrovault.api;

import io.astrovault.domain.Frame;
import io.astrovault.domain.FrameProcessingStatus;
import io.astrovault.domain.FrameType;
import io.astrovault.domain.JobStatus;
import io.astrovault.domain.JobType;
import io.astrovault.domain.ProcessingJob;
import io.astrovault.ingest.SessionAssignmentService;
import io.astrovault.jobs.JobQueue;
import jakarta.inject.Inject;
import jakarta.transaction.Transactional;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.HeaderParam;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import org.eclipse.microprofile.config.inject.ConfigProperty;

import java.time.Instant;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

@Path("/internal/worker/ingest")
@Consumes(MediaType.APPLICATION_JSON)
@Produces(MediaType.APPLICATION_JSON)
public class InternalIngestResource {

    @ConfigProperty(name = "astrovault.worker.token")
    String workerToken;

    @Inject
    SessionAssignmentService sessionAssignmentService;

    @Inject
    JobQueue jobQueue;

    public record RegisterRequest(String originalFilename, String storageKey, String checksum, String sourceName, FrameType frameType) {}
    public record SeenRequest(String sourcePath) {}
    public record SeenResponse(boolean seen) {}
    public record SeenBatchRequest(List<String> sourcePaths) {}
    public record SeenBatchResponse(Set<String> seenPaths) {}

    private static final Pattern SOURCE_PATH_PATTERN = Pattern.compile("path=([^|]+)");

    @POST
    @Path("/seen")
    @Transactional
    public Response seen(@HeaderParam("X-Worker-Token") String token, SeenRequest req) {
        if (!workerToken.equals(token)) {
            return Response.status(Response.Status.UNAUTHORIZED).build();
        }
        if (req == null || req.sourcePath() == null || req.sourcePath().isBlank()) {
            return Response.ok(new SeenResponse(false)).build();
        }
        long count = Frame.count("sourceName like ?1", "%path=" + req.sourcePath() + "%");
        return Response.ok(new SeenResponse(count > 0)).build();
    }

    @POST
    @Path("/seen-batch")
    @Transactional
    public Response seenBatch(@HeaderParam("X-Worker-Token") String token, SeenBatchRequest req) {
        if (!workerToken.equals(token)) {
            return Response.status(Response.Status.UNAUTHORIZED).build();
        }
        if (req == null || req.sourcePaths() == null || req.sourcePaths().isEmpty()) {
            return Response.ok(new SeenBatchResponse(Set.of())).build();
        }
        Set<String> requested = new HashSet<>(req.sourcePaths());
        Set<String> seen = new HashSet<>();
        List<Frame> frames = Frame.list("sourceName like ?1", "%path=%");
        for (Frame frame : frames) {
            if (frame.sourceName == null) {
                continue;
            }
            Matcher matcher = SOURCE_PATH_PATTERN.matcher(frame.sourceName);
            while (matcher.find()) {
                String path = matcher.group(1).trim();
                if (requested.contains(path)) {
                    seen.add(path);
                }
            }
        }
        return Response.ok(new SeenBatchResponse(seen)).build();
    }

    @POST
    @Path("/register")
    @Transactional
    public Response register(@HeaderParam("X-Worker-Token") String token, RegisterRequest req) {
        if (!workerToken.equals(token)) {
            return Response.status(Response.Status.UNAUTHORIZED).build();
        }
        Frame duplicate = Frame.find("checksum", req.checksum()).firstResult();
        if (duplicate != null) {
            if (req.sourceName() != null && !req.sourceName().isBlank()
                    && (duplicate.sourceName == null || !duplicate.sourceName.contains(req.sourceName()))) {
                duplicate.sourceName = duplicate.sourceName == null || duplicate.sourceName.isBlank()
                        ? req.sourceName()
                        : duplicate.sourceName + " | duplicateSource=" + req.sourceName();
            }
            return Response.status(Response.Status.CONFLICT).entity("Duplicate checksum").build();
        }
        Frame frame = new Frame();
        frame.session = sessionAssignmentService.unassignedSession();
        frame.originalFilename = req.originalFilename();
        frame.storageKey = req.storageKey();
        frame.checksum = req.checksum();
        frame.sourceName = req.sourceName();
        frame.frameType = req.frameType() == null ? FrameType.LIGHT : req.frameType();
        frame.processingStatus = FrameProcessingStatus.PENDING;
        frame.observedAt = Instant.now();
        frame.persist();

        enqueue(JobType.METADATA_EXTRACTION, frame.id);
        enqueue(JobType.PREVIEW_GENERATION, frame.id);
        return Response.status(Response.Status.CREATED).entity(frame).build();
    }

    private void enqueue(JobType type, Long frameId) {
        ProcessingJob job = new ProcessingJob();
        job.type = type;
        job.status = JobStatus.PENDING;
        job.createdAt = Instant.now();
        job.frameId = frameId;
        job.persistAndFlush();
        jobQueue.enqueue(job);
    }

}
