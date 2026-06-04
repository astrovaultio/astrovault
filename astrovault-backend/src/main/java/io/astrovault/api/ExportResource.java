package io.astrovault.api;

import io.astrovault.domain.JobStatus;
import io.astrovault.domain.JobType;
import io.astrovault.domain.ProcessingJob;
import io.astrovault.storage.StorageService;
import jakarta.annotation.security.RolesAllowed;
import jakarta.inject.Inject;
import jakarta.transaction.Transactional;
import jakarta.ws.rs.DELETE;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.Response;
import jakarta.ws.rs.core.StreamingOutput;

import java.util.List;

@Path("/api/exports")
@RolesAllowed({"ADMIN", "USER", "VIEWER"})
public class ExportResource {

    @Inject
    StorageService storageService;

    @GET
    @Path("/session/{sessionId}")
    @Produces("application/json")
    public List<ProcessingJob> listSessionExports(@PathParam("sessionId") Long sessionId) {
        return ProcessingJob.list("type = ?1 and sessionId = ?2 order by id desc", JobType.SESSION_EXPORT, sessionId);
    }

    @GET
    @Path("/{jobId}/download")
    @Produces("application/zip")
    public Response download(@PathParam("jobId") Long jobId) {
        ProcessingJob job = ProcessingJob.findById(jobId);
        if (job == null || job.type != JobType.SESSION_EXPORT) {
            return Response.status(Response.Status.NOT_FOUND).build();
        }
        if (job.status != JobStatus.COMPLETED || job.resultStorageKey == null) {
            return Response.status(Response.Status.CONFLICT).entity("Export not ready").build();
        }
        StreamingOutput stream = output -> {
            try (var input = storageService.getStream("exports", job.resultStorageKey)) {
                input.transferTo(output);
            }
        };
        return Response.ok(stream)
                .header("Content-Disposition", "attachment; filename=\"" + job.resultStorageKey + "\"")
                .header("X-Content-Type-Options", "nosniff")
                .build();
    }

    @DELETE
    @Path("/{jobId}")
    @Transactional
    @RolesAllowed({"ADMIN", "USER"})
    public Response delete(@PathParam("jobId") Long jobId) {
        ProcessingJob job = ProcessingJob.findById(jobId);
        if (job == null || job.type != JobType.SESSION_EXPORT) {
            return Response.status(Response.Status.NOT_FOUND).build();
        }
        if (job.resultStorageKey != null && !job.resultStorageKey.isBlank()) {
            storageService.delete("exports", job.resultStorageKey);
        }
        job.delete();
        return Response.noContent().build();
    }
}
