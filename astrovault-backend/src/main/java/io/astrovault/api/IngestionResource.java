package io.astrovault.api;

import io.astrovault.domain.Frame;
import io.astrovault.domain.FrameProcessingStatus;
import io.astrovault.domain.FrameType;
import io.astrovault.domain.ImagingSession;
import io.astrovault.domain.JobStatus;
import io.astrovault.domain.JobType;
import io.astrovault.domain.ProcessingJob;
import io.astrovault.jobs.JobQueue;
import io.astrovault.ingest.IngestService;
import jakarta.annotation.security.RolesAllowed;
import jakarta.inject.Inject;
import jakarta.transaction.Transactional;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import java.time.Instant;
import org.eclipse.microprofile.config.inject.ConfigProperty;

@Path("/api/ingestion")
@Consumes(MediaType.APPLICATION_JSON)
@Produces(MediaType.APPLICATION_JSON)
@RolesAllowed({"ADMIN", "USER"})
public class IngestionResource {

    @Inject
    JobQueue jobQueue;

    @Inject
    IngestService ingestService;

    @ConfigProperty(name = "astrovault.ingest.path")
    String ingestPath;

    public record ImportFrameRequest(Long sessionId, String originalFilename, String storageKey, String checksum, FrameType frameType) {}

    @POST
    @Path("/frames")
    @Transactional
    public Frame importFrame(ImportFrameRequest request) {
        if (Frame.count("checksum", request.checksum()) > 0) {
            throw new IllegalStateException("Duplicate frame checksum");
        }

        ImagingSession session = ImagingSession.findById(request.sessionId());
        if (session == null) {
            throw new IllegalArgumentException("Session not found");
        }

        Frame frame = new Frame();
        frame.session = session;
        frame.originalFilename = request.originalFilename();
        frame.storageKey = request.storageKey();
        frame.checksum = request.checksum();
        frame.frameType = request.frameType() == null ? FrameType.LIGHT : request.frameType();
        frame.processingStatus = FrameProcessingStatus.PENDING;
        frame.persist();

        createJob(JobType.METADATA_EXTRACTION, frame.id);
        createJob(JobType.PREVIEW_GENERATION, frame.id);
        return frame;
    }

    public record ScanResponse(int imported) {}

    @POST
    @Path("/scan")
    public ScanResponse scanFolder() {
        return new ScanResponse(ingestService.scanFolder(java.nio.file.Path.of(ingestPath)));
    }

    private void createJob(JobType type, Long frameId) {
        ProcessingJob job = new ProcessingJob();
        job.type = type;
        job.status = JobStatus.PENDING;
        job.createdAt = Instant.now();
        job.frameId = frameId;
        job.persistAndFlush();
        jobQueue.enqueue(job);
    }
}
