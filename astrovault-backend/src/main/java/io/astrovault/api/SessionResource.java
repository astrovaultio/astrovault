package io.astrovault.api;

import io.astrovault.domain.Frame;
import io.astrovault.domain.FrameType;
import io.astrovault.domain.ImagingSession;
import io.astrovault.domain.JobStatus;
import io.astrovault.domain.JobType;
import io.astrovault.domain.ProcessedAsset;
import io.astrovault.domain.ProcessingJob;
import io.astrovault.domain.Target;
import io.astrovault.ingest.SessionAssignmentService;
import io.astrovault.storage.StorageService;
import jakarta.annotation.security.RolesAllowed;
import jakarta.inject.Inject;
import jakarta.transaction.Transactional;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.DELETE;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.PATCH;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import org.jboss.resteasy.annotations.providers.multipart.MultipartForm;

import java.io.IOException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Objects;
import java.util.UUID;

@Path("/api/sessions")
@Produces(MediaType.APPLICATION_JSON)
@RolesAllowed({"ADMIN", "USER", "VIEWER"})
public class SessionResource {

    @Inject
    StorageService storageService;

    @Inject
    SessionAssignmentService sessionAssignmentService;

    public record WorkflowStep(String label, boolean done) {}
    public record WorkflowStatus(List<WorkflowStep> steps, int completedSteps, int totalSteps, String label, String status, boolean manual) {}
    public record SessionDetail(ImagingSession session, List<Frame> frames, List<ProcessedAsset> processedAssets, WorkflowStatus workflowStatus) {}
    public record ExportResponse(Long jobId) {}
    public record SessionCreateRequest(Long targetId, String notes, Instant startTime, Instant endTime, String logicalGroupKey) {}
    public record SessionPatchRequest(Long targetId, String notes, Instant startTime, Instant endTime, String logicalGroupKey, String manualWorkflowStatus) {}
    public record SessionGroupRequest(String logicalGroupKey, List<Long> sessionIds) {}

    @GET
    public List<ImagingSession> sessions() {
        return ImagingSession.list("order by startTime desc nulls last, id desc");
    }

    @GET
    @Path("/{id}")
    public Response sessionDetail(@PathParam("id") Long id) {
        ImagingSession session = ImagingSession.findById(id);
        if (session == null) return Response.status(Response.Status.NOT_FOUND).build();
        List<Frame> frames = Frame.list("session.id", id);
        List<ProcessedAsset> processedAssets = ProcessedAsset.list("session.id", id);
        return Response.ok(new SessionDetail(session, frames, processedAssets, workflowStatus(session, frames, processedAssets))).build();
    }

    @POST
    @Transactional
    @RolesAllowed({"ADMIN", "USER"})
    public Response createSession(SessionCreateRequest req) {
        Target target = req.targetId() == null ? null : Target.findById(req.targetId());
        if (req.targetId() != null && target == null) {
            return Response.status(Response.Status.BAD_REQUEST).entity("Target not found").build();
        }
        ImagingSession session = new ImagingSession();
        session.target = target;
        session.notes = req.notes();
        session.startTime = req.startTime();
        session.endTime = req.endTime();
        session.totalIntegrationTime = 0L;
        session.logicalGroupKey = req.logicalGroupKey();
        session.persist();
        return Response.ok(session).build();
    }

    @PATCH
    @Path("/{id}")
    @Transactional
    @RolesAllowed({"ADMIN", "USER"})
    public Response patchSession(@PathParam("id") Long id, SessionPatchRequest req) {
        ImagingSession session = ImagingSession.findById(id);
        if (session == null) {
            return Response.status(Response.Status.NOT_FOUND).build();
        }
        if (req.targetId() != null) {
            Target target = Target.findById(req.targetId());
            if (target == null) {
                return Response.status(Response.Status.BAD_REQUEST).entity("Target not found").build();
            }
            session.target = target;
        }
        if (req.notes() != null) session.notes = req.notes();
        if (req.startTime() != null) session.startTime = req.startTime();
        if (req.endTime() != null) session.endTime = req.endTime();
        if (req.logicalGroupKey() != null) session.logicalGroupKey = req.logicalGroupKey().isBlank() ? null : req.logicalGroupKey();
        if (req.manualWorkflowStatus() != null) {
            String normalizedStatus = req.manualWorkflowStatus().isBlank() ? null : req.manualWorkflowStatus().trim().toUpperCase();
            if (normalizedStatus != null && !List.of("IN_PROGRESS", "CAPTURE", "CALIBRATION", "STACKED", "PROCESSED", "PUBLISHED").contains(normalizedStatus)) {
                return Response.status(Response.Status.BAD_REQUEST).entity("Invalid workflow status").build();
            }
            session.manualWorkflowStatus = normalizedStatus;
        }
        sessionAssignmentService.recalculateSession(session);
        return Response.ok(session).build();
    }

    @POST
    @Path("/group")
    @Transactional
    @RolesAllowed({"ADMIN", "USER"})
    public Response groupSessions(SessionGroupRequest req) {
        if (req == null || req.sessionIds() == null || req.sessionIds().isEmpty()) {
            return Response.status(Response.Status.BAD_REQUEST).entity("sessionIds are required").build();
        }
        String key = req.logicalGroupKey() == null || req.logicalGroupKey().isBlank() ? "group-" + UUID.randomUUID() : req.logicalGroupKey().trim();
        List<ImagingSession> updated = new ArrayList<>();
        for (Long id : req.sessionIds()) {
            ImagingSession session = ImagingSession.findById(id);
            if (session == null) {
                return Response.status(Response.Status.BAD_REQUEST).entity("Session not found: " + id).build();
            }
            session.logicalGroupKey = key;
            updated.add(session);
        }
        return Response.ok(updated).build();
    }

    @DELETE
    @Path("/{id}")
    @Transactional
    @RolesAllowed({"ADMIN", "USER"})
    public Response deleteSession(@PathParam("id") Long id) {
        ImagingSession session = ImagingSession.findById(id);
        if (session == null) {
            return Response.status(Response.Status.NOT_FOUND).build();
        }
        long frames = Frame.count("session.id", id);
        if (frames > 0) {
            return Response.status(Response.Status.CONFLICT).entity("Session is not empty").build();
        }
        session.delete();
        return Response.noContent().build();
    }

    @POST
    @Path("/{id}/export")
    @Transactional
    @RolesAllowed({"ADMIN", "USER"})
    public Response exportSession(@PathParam("id") Long id) {
        ImagingSession session = ImagingSession.findById(id);
        if (session == null) return Response.status(Response.Status.NOT_FOUND).build();
        ProcessingJob job = new ProcessingJob();
        job.type = JobType.SESSION_EXPORT;
        job.status = JobStatus.PENDING;
        job.createdAt = Instant.now();
        job.sessionId = id;
        job.persist();
        return Response.ok(new ExportResponse(job.id)).build();
    }

    @POST
    @Path("/{id}/frames/{frameId}/move")
    @Transactional
    @RolesAllowed({"ADMIN", "USER"})
    public Response moveFrameToSession(@PathParam("id") Long id, @PathParam("frameId") Long frameId) {
        return moveFrameInternal(frameId, id);
    }

    @POST
    @Path("/frames/{frameId}/move-to-session/{sessionId}")
    @Transactional
    @RolesAllowed({"ADMIN", "USER"})
    public Response moveFrameToSessionAlt(@PathParam("frameId") Long frameId, @PathParam("sessionId") Long sessionId) {
        return moveFrameInternal(frameId, sessionId);
    }

    @POST
    @Path("/frames/{frameId}/detach")
    @Transactional
    @RolesAllowed({"ADMIN", "USER"})
    public Response detachFrame(@PathParam("frameId") Long frameId) {
        Frame frame = Frame.findById(frameId);
        if (frame == null) {
            return Response.status(Response.Status.NOT_FOUND).build();
        }
        ImagingSession oldSession = frame.session;
        ImagingSession newSession = new ImagingSession();
        newSession.target = oldSession == null ? null : oldSession.target;
        newSession.notes = "Detached frame session";
        newSession.startTime = frame.observedAt;
        newSession.endTime = frame.observedAt;
        newSession.totalIntegrationTime = frame.frameType == FrameType.LIGHT && frame.exposureSeconds != null ? frame.exposureSeconds : 0L;
        newSession.persist();
        frame.session = newSession;
        if (oldSession != null) {
            sessionAssignmentService.recalculateSession(oldSession);
        }
        sessionAssignmentService.recalculateSession(newSession);
        return Response.ok(frame).build();
    }

    @POST
    @Path("/{id}/processed-assets")
    @Consumes(MediaType.MULTIPART_FORM_DATA)
    @Transactional
    @RolesAllowed({"ADMIN", "USER"})
    public Response uploadProcessed(@PathParam("id") Long id, @MultipartForm ProcessedAssetUploadForm form) {
        ImagingSession session = ImagingSession.findById(id);
        if (session == null) return Response.status(Response.Status.NOT_FOUND).build();
        if (form.file == null || form.fileName == null || form.fileName.isBlank()) {
            return Response.status(Response.Status.BAD_REQUEST).entity("Missing file").build();
        }
        try {
            byte[] content = form.file.readAllBytes();
            String key = "session-" + id + "/" + UUID.randomUUID() + "-" + form.fileName;
            storageService.put("processed", key, content, form.contentType == null ? "application/octet-stream" : form.contentType);
            ProcessedAsset asset = new ProcessedAsset();
            asset.session = session;
            asset.target = session.target;
            asset.title = form.title;
            asset.description = form.description;
            asset.software = form.software;
            asset.versionLabel = form.versionLabel;
            asset.notes = form.notes;
            asset.storageKey = key;
            asset.createdAt = Instant.now();
            asset.persist();
            return Response.ok(asset).build();
        } catch (IOException e) {
            return Response.serverError().entity("Upload failed: " + e.getMessage()).build();
        }
    }

    @POST
    @Path("/processed-assets/link")
    @Consumes(MediaType.MULTIPART_FORM_DATA)
    @Transactional
    @RolesAllowed({"ADMIN", "USER"})
    public Response uploadProcessedLinked(@MultipartForm ProcessedAssetUploadForm form) {
        if (form.file == null || form.fileName == null || form.fileName.isBlank()) {
            return Response.status(Response.Status.BAD_REQUEST).entity("Missing file").build();
        }
        if (form.sessionIds == null || form.sessionIds.isBlank()) {
            return Response.status(Response.Status.BAD_REQUEST).entity("Missing sessionIds").build();
        }
        List<Long> sessionIds = Arrays.stream(form.sessionIds.split(","))
                .map(String::trim)
                .filter(v -> !v.isEmpty())
                .map(Long::valueOf)
                .toList();
        if (sessionIds.isEmpty()) {
            return Response.status(Response.Status.BAD_REQUEST).entity("No valid sessionIds").build();
        }
        try {
            byte[] content = form.file.readAllBytes();
            String sharedKey = "processed-linked/" + UUID.randomUUID() + "-" + form.fileName;
            storageService.put("processed", sharedKey, content, form.contentType == null ? "application/octet-stream" : form.contentType);
            List<ProcessedAsset> created = new ArrayList<>();
            for (Long sessionId : sessionIds.stream().filter(Objects::nonNull).distinct().toList()) {
                ImagingSession session = ImagingSession.findById(sessionId);
                if (session == null) {
                    return Response.status(Response.Status.BAD_REQUEST).entity("Session not found: " + sessionId).build();
                }
                ProcessedAsset asset = new ProcessedAsset();
                asset.session = session;
                asset.target = session.target;
                asset.title = form.title;
                asset.description = form.description;
                asset.software = form.software;
                asset.versionLabel = form.versionLabel;
                asset.notes = form.notes;
                asset.storageKey = sharedKey;
                asset.createdAt = Instant.now();
                asset.persist();
                created.add(asset);
            }
            return Response.ok(created).build();
        } catch (IOException e) {
            return Response.serverError().entity("Upload failed: " + e.getMessage()).build();
        }
    }

    private Response moveFrameInternal(Long frameId, Long sessionId) {
        Frame frame = Frame.findById(frameId);
        if (frame == null) {
            return Response.status(Response.Status.NOT_FOUND).entity("Frame not found").build();
        }
        ImagingSession targetSession = ImagingSession.findById(sessionId);
        if (targetSession == null) {
            return Response.status(Response.Status.NOT_FOUND).entity("Session not found").build();
        }
        ImagingSession oldSession = frame.session;
        frame.session = targetSession;
        if (oldSession != null) {
            sessionAssignmentService.recalculateSession(oldSession);
        }
        sessionAssignmentService.recalculateSession(targetSession);
        return Response.ok(frame).build();
    }

    static WorkflowStatus workflowStatus(ImagingSession session, List<Frame> frames, List<ProcessedAsset> processedAssets) {
        if (session.manualWorkflowStatus != null && !session.manualWorkflowStatus.isBlank()) {
            return manualWorkflowStatus(session.manualWorkflowStatus);
        }
        boolean hasFrames = !frames.isEmpty();
        boolean hasLights = frames.stream().anyMatch(f -> f.frameType == FrameType.LIGHT);
        boolean hasCalibration = frames.stream().anyMatch(f -> f.frameType == FrameType.DARK || f.frameType == FrameType.FLAT || f.frameType == FrameType.BIAS || f.frameType == FrameType.DARK_FLAT);
        boolean hasProcessed = !processedAssets.isEmpty();
        boolean hasStacked = hasProcessed || processedAssets.stream().anyMatch(a -> containsIgnoreCase(a.title, "stack") || containsIgnoreCase(a.software, "stack"));
        boolean hasPublished = processedAssets.stream().anyMatch(a -> containsIgnoreCase(a.versionLabel, "published") || containsIgnoreCase(a.notes, "published"));
        List<WorkflowStep> steps = List.of(
                new WorkflowStep("Capture", hasLights || hasFrames),
                new WorkflowStep("Calibration", hasCalibration),
                new WorkflowStep("Stacked", hasStacked),
                new WorkflowStep("Processed", hasProcessed),
                new WorkflowStep("Published", hasPublished)
        );
        int completed = (int) steps.stream().filter(WorkflowStep::done).count();
        return new WorkflowStatus(steps, completed, steps.size(), completed + "/" + steps.size(), completed + "/" + steps.size(), false);
    }

    private static WorkflowStatus manualWorkflowStatus(String status) {
        int completed = switch (status) {
            case "CAPTURE", "IN_PROGRESS" -> 1;
            case "CALIBRATION" -> 2;
            case "STACKED" -> 3;
            case "PROCESSED" -> 4;
            case "PUBLISHED" -> 5;
            default -> 0;
        };
        List<String> labels = List.of("Capture", "Calibration", "Stacked", "Processed", "Published");
        List<WorkflowStep> steps = labels.stream()
                .map(label -> new WorkflowStep(label, labels.indexOf(label) < completed))
                .toList();
        String display = switch (status) {
            case "IN_PROGRESS" -> "In Progress";
            case "CAPTURE" -> "Capture";
            case "CALIBRATION" -> "Calibration";
            case "STACKED" -> "Stacked";
            case "PROCESSED" -> "Processed";
            case "PUBLISHED" -> "Published";
            default -> status;
        };
        return new WorkflowStatus(steps, completed, steps.size(), completed + "/" + steps.size(), display, true);
    }

    private static boolean containsIgnoreCase(String value, String needle) {
        return value != null && value.toLowerCase().contains(needle.toLowerCase());
    }
}
