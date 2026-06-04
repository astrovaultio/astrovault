package io.astrovault.api;

import io.astrovault.domain.Frame;
import io.astrovault.domain.FrameProcessingStatus;
import io.astrovault.domain.JobStatus;
import io.astrovault.domain.JobType;
import io.astrovault.domain.ProcessingJob;
import io.astrovault.jobs.JobQueue;
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
import java.util.List;

@Path("/api/jobs")
@Produces(MediaType.APPLICATION_JSON)
@RolesAllowed({"ADMIN", "USER", "VIEWER"})
public class JobResource {

    @Inject
    JobQueue jobQueue;

    @GET
    public List<ProcessingJob> jobs() {
        return ProcessingJob.list("order by createdAt desc nulls last, id desc");
    }

    @POST
    @Path("/{id}/cancel")
    @Transactional
    @RolesAllowed({"ADMIN", "USER"})
    public Response cancelJob(@PathParam("id") Long id) {
        ProcessingJob job = ProcessingJob.findById(id);
        if (job == null) {
            return Response.status(Response.Status.NOT_FOUND).build();
        }
        if (job.status == JobStatus.COMPLETED || job.status == JobStatus.FAILED || job.status == JobStatus.CANCELLED) {
            return Response.status(Response.Status.CONFLICT).entity("Job is already finished").build();
        }
        job.status = JobStatus.CANCELLED;
        job.finishedAt = Instant.now();
        job.errorMessage = "Cancelled by user";
        return Response.ok(job).build();
    }

    @POST
    @Path("/{id}/retry")
    @Transactional
    @RolesAllowed({"ADMIN", "USER"})
    public Response retryJob(@PathParam("id") Long id) {
        ProcessingJob failed = ProcessingJob.findById(id);
        if (failed == null) {
            return Response.status(Response.Status.NOT_FOUND).build();
        }
        if (failed.status != JobStatus.FAILED) {
            return Response.status(Response.Status.CONFLICT).entity("Only failed jobs can be retried").build();
        }

        ProcessingJob retry = new ProcessingJob();
        retry.type = failed.type;
        retry.status = JobStatus.PENDING;
        retry.createdAt = Instant.now();
        retry.frameId = failed.frameId;
        retry.sessionId = failed.sessionId;
        retry.persistAndFlush();

        if (retry.frameId != null && (retry.type == JobType.METADATA_EXTRACTION || retry.type == JobType.PREVIEW_GENERATION)) {
            Frame frame = Frame.findById(retry.frameId);
            if (frame != null) {
                frame.processingStatus = FrameProcessingStatus.PENDING;
            }
            jobQueue.enqueue(retry);
        }

        return Response.status(Response.Status.CREATED).entity(retry).build();
    }
}
