package io.astrovault.api;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.astrovault.domain.Frame;
import io.astrovault.domain.FrameProcessingStatus;
import io.astrovault.domain.FrameType;
import io.astrovault.domain.ImagingSession;
import io.astrovault.domain.JobStatus;
import io.astrovault.domain.ProcessingJob;
import io.astrovault.ingest.FitsHeaderInfo;
import io.astrovault.ingest.SessionAssignmentService;
import jakarta.inject.Inject;
import jakarta.persistence.EntityManager;
import jakarta.transaction.Transactional;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.HeaderParam;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.jboss.logging.Logger;

import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.format.DateTimeParseException;
import java.util.List;
import java.util.concurrent.atomic.AtomicBoolean;

@Path("/internal/worker")
@Consumes(MediaType.APPLICATION_JSON)
@Produces(MediaType.APPLICATION_JSON)
public class WorkerCallbackResource {

    private static final Logger LOG = Logger.getLogger(WorkerCallbackResource.class);
    private static final AtomicBoolean METADATA_COLUMN_CHECKED = new AtomicBoolean(false);

    @ConfigProperty(name = "astrovault.worker.token")
    String workerToken;

    @Inject
    EntityManager entityManager;

    @Inject
    SessionAssignmentService sessionAssignmentService;

    private final ObjectMapper objectMapper = new ObjectMapper();

    public record JobUpdateRequest(String status, String errorMessage) {}
    public record MetadataUpdateRequest(String metadata, String frameType) {}
    public record PreviewUpdateRequest(String previewStorageKey, String thumbnailStorageKey) {}
    public record FrameWorkerView(Long id, String storageKey, String checksum, String originalFilename, String sourceName) {}

    @GET
    @Path("/jobs/{jobId}")
    public Response jobInfo(@HeaderParam("X-Worker-Token") String token, @PathParam("jobId") Long jobId) {
        if (!workerToken.equals(token)) {
            LOG.warnf("Unauthorized jobInfo callback jobId=%s", jobId);
            return Response.status(Response.Status.UNAUTHORIZED).build();
        }
        ProcessingJob job = ProcessingJob.findById(jobId);
        if (job == null) {
            LOG.warnf("Job not found for worker jobInfo jobId=%s", jobId);
            return Response.status(Response.Status.NOT_FOUND).build();
        }
        return Response.ok(job).build();
    }

    @GET
    @Path("/frames/{frameId}")
    public Response frameInfo(@HeaderParam("X-Worker-Token") String token, @PathParam("frameId") Long frameId) {
        if (!workerToken.equals(token)) {
            LOG.warnf("Unauthorized frameInfo callback frameId=%s", frameId);
            return Response.status(Response.Status.UNAUTHORIZED).build();
        }
        Frame frame = Frame.findById(frameId);
        if (frame == null) {
            LOG.warnf("Frame not found for worker frameInfo frameId=%s", frameId);
            return Response.status(Response.Status.NOT_FOUND).build();
        }
        LOG.debugf("Worker frameInfo served frameId=%s storageKey=%s", frame.id, frame.storageKey);
        return Response.ok(new FrameWorkerView(frame.id, frame.storageKey, frame.checksum, frame.originalFilename, frame.sourceName)).build();
    }

    @POST
    @Path("/jobs/{jobId}")
    @Transactional
    public Response updateJob(@HeaderParam("X-Worker-Token") String token, @PathParam("jobId") Long jobId, JobUpdateRequest req) {
        if (!workerToken.equals(token)) {
            LOG.warnf("Unauthorized job update callback jobId=%s", jobId);
            return Response.status(Response.Status.UNAUTHORIZED).build();
        }
        ProcessingJob job = ProcessingJob.findById(jobId);
        if (job == null) {
            LOG.warnf("Worker updated unknown job jobId=%s", jobId);
            return Response.status(Response.Status.NOT_FOUND).build();
        }
        if (job.status == JobStatus.CANCELLED) {
            LOG.warnf("Ignoring update for cancelled job jobId=%s incomingStatus=%s", jobId, req.status());
            return Response.status(Response.Status.CONFLICT).entity("Job cancelled").build();
        }
        LOG.infof("Worker job update jobId=%s from=%s to=%s", jobId, job.status, req.status());
        job.status = Enum.valueOf(io.astrovault.domain.JobStatus.class, req.status());
        if ("RUNNING".equals(req.status())) {
            job.startedAt = Instant.now();
        }
        if ("COMPLETED".equals(req.status()) || "FAILED".equals(req.status())) {
            job.finishedAt = Instant.now();
        }
        job.errorMessage = req.errorMessage();
        if (req.errorMessage() != null && !req.errorMessage().isBlank()) {
            LOG.errorf("Worker reported job error jobId=%s error=%s", jobId, req.errorMessage());
        }
        if (job.frameId != null) {
            updateFrameProcessingStatus(job.frameId);
        }
        return Response.ok(job).build();
    }

    private void updateFrameProcessingStatus(Long frameId) {
        Frame frame = Frame.findById(frameId);
        if (frame == null) {
            return;
        }
        List<ProcessingJob> jobs = ProcessingJob.list("frameId = ?1", frameId);
        if (jobs.stream().anyMatch(j -> j.status == JobStatus.FAILED)) {
            frame.processingStatus = FrameProcessingStatus.FAILED;
        } else if (jobs.stream().anyMatch(j -> j.status == JobStatus.RUNNING)) {
            frame.processingStatus = FrameProcessingStatus.PROCESSING;
        } else if (jobs.stream().anyMatch(j -> j.status == JobStatus.PENDING)) {
            frame.processingStatus = FrameProcessingStatus.PENDING;
        } else if (!jobs.isEmpty() && jobs.stream().allMatch(j -> j.status == JobStatus.COMPLETED)) {
            frame.processingStatus = FrameProcessingStatus.READY;
        }
    }

    @POST
    @Path("/frames/{frameId}/metadata")
    @Transactional
    public Response updateMetadata(@HeaderParam("X-Worker-Token") String token, @PathParam("frameId") Long frameId, MetadataUpdateRequest req) {
        if (!workerToken.equals(token)) {
            LOG.warnf("Unauthorized metadata callback frameId=%s", frameId);
            return Response.status(Response.Status.UNAUTHORIZED).build();
        }
        ensureMetadataColumnType();
        Frame frame = Frame.findById(frameId);
        if (frame == null) {
            LOG.warnf("Metadata callback for unknown frame frameId=%s", frameId);
            return Response.status(Response.Status.NOT_FOUND).build();
        }
        LOG.infof("Metadata callback received frameId=%s metadataBytes=%s", frameId, req.metadata() == null ? 0 : req.metadata().length());
        frame.metadata = req.metadata();
        if (req.frameType() != null && !req.frameType().isBlank()) {
            frame.frameType = Enum.valueOf(io.astrovault.domain.FrameType.class, req.frameType());
        }
        FitsHeaderInfo info = extractInfo(req.metadata(), frame.observedAt);
        frame.cameraName = info.cameraName();
        frame.observedAt = info.dateObs() == null ? frame.observedAt : info.dateObs();
        frame.exposureSeconds = info.exposureSeconds();

        ImagingSession oldSession = frame.session;
        ImagingSession assigned = sessionAssignmentService.assignSession(info, frame.observedAt == null ? Instant.now() : frame.observedAt, frame.frameType);
        frame.session = assigned;
        if (oldSession != null && oldSession.id != null && !oldSession.id.equals(assigned.id)) {
            LOG.infof("Frame reassigned after metadata frameId=%s fromSession=%s toSession=%s", frame.id, oldSession.id, assigned.id);
            sessionAssignmentService.recalculateSession(oldSession);
        }
        sessionAssignmentService.recalculateSession(assigned);
        LOG.debugf("Metadata callback applied frameId=%s observedAt=%s camera=%s", frame.id, frame.observedAt, frame.cameraName);
        return Response.ok(frame).build();
    }

    private void ensureMetadataColumnType() {
        if (METADATA_COLUMN_CHECKED.get()) {
            return;
        }
        Object currentType = entityManager.createNativeQuery("""
                select data_type
                from information_schema.columns
                where table_schema = 'public' and table_name = 'frame' and column_name = 'metadata'
                """).getSingleResult();
        if (currentType != null && !"text".equalsIgnoreCase(currentType.toString())) {
            LOG.warnf("Adjusting frame.metadata column type from %s to text", currentType);
            entityManager.createNativeQuery("ALTER TABLE frame ALTER COLUMN metadata TYPE TEXT").executeUpdate();
        }
        LOG.debug("Metadata column check completed");
        METADATA_COLUMN_CHECKED.set(true);
    }

    @POST
    @Path("/frames/{frameId}/previews")
    @Transactional
    public Response updatePreview(@HeaderParam("X-Worker-Token") String token, @PathParam("frameId") Long frameId, PreviewUpdateRequest req) {
        if (!workerToken.equals(token)) {
            LOG.warnf("Unauthorized preview callback frameId=%s", frameId);
            return Response.status(Response.Status.UNAUTHORIZED).build();
        }
        Frame frame = Frame.findById(frameId);
        if (frame == null) {
            LOG.warnf("Preview callback for unknown frame frameId=%s", frameId);
            return Response.status(Response.Status.NOT_FOUND).build();
        }
        frame.previewStorageKey = req.previewStorageKey();
        frame.thumbnailStorageKey = req.thumbnailStorageKey();
        updateFrameProcessingStatus(frameId);
        LOG.infof("Preview callback applied frameId=%s preview=%s thumb=%s", frame.id, req.previewStorageKey(), req.thumbnailStorageKey());
        return Response.ok(frame).build();
    }

    private FitsHeaderInfo extractInfo(String metadata, Instant fallbackObservedAt) {
        try {
            JsonNode root = objectMapper.readTree(metadata == null ? "{}" : metadata);
            String object = text(root, "object");
            String camera = text(root, "camera");
            if (camera == null) {
                JsonNode header = root.get("header");
                if (header != null && header.isObject()) {
                    camera = firstNonBlank(text(header, "INSTRUME"), text(header, "CAMERA"), text(header, "DETECTOR"));
                }
            }
            String dateObsRaw = text(root, "dateObs");
            Instant dateObs = parseDate(dateObsRaw);
            Long exposure = asLong(root.get("exposureTime"));
            return new FitsHeaderInfo(object, camera, dateObs == null ? fallbackObservedAt : dateObs, exposure);
        } catch (Exception e) {
            LOG.errorf("Failed to parse metadata payload, fallback observedAt used: %s", e.getMessage());
            return new FitsHeaderInfo(null, null, fallbackObservedAt, null);
        }
    }

    private Instant parseDate(String raw) {
        if (raw == null || raw.isBlank()) {
            return null;
        }
        try {
            if (raw.endsWith("Z") || raw.contains("+") || raw.matches(".*-\\d\\d:?\\d\\d$")) {
                return OffsetDateTime.parse(raw).toInstant();
            }
            return Instant.parse(raw + "Z");
        } catch (DateTimeParseException e) {
            return null;
        }
    }

    private String text(JsonNode node, String key) {
        JsonNode v = node == null ? null : node.get(key);
        return v == null || v.isNull() ? null : v.asText();
    }

    private Long asLong(JsonNode node) {
        if (node == null || node.isNull()) {
            return null;
        }
        return Math.round(node.asDouble());
    }

    private String firstNonBlank(String... values) {
        for (String value : values) {
            if (value != null && !value.isBlank()) {
                return value;
            }
        }
        return null;
    }
}
