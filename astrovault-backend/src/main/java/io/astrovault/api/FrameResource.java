package io.astrovault.api;

import io.astrovault.domain.Frame;
import io.astrovault.domain.FrameType;
import io.astrovault.domain.ImagingSession;
import io.astrovault.domain.ProcessingJob;
import io.astrovault.ingest.SessionAssignmentService;
import io.astrovault.storage.StorageService;
import jakarta.annotation.security.RolesAllowed;
import jakarta.inject.Inject;
import jakarta.transaction.Transactional;
import jakarta.ws.rs.DELETE;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import java.util.List;

@Path("/api/frames")
@RolesAllowed({"ADMIN", "USER", "VIEWER"})
public class FrameResource {

    @Inject
    StorageService storageService;

    @Inject
    SessionAssignmentService sessionAssignmentService;

    @GET
    @Produces(MediaType.APPLICATION_JSON)
    public List<Frame> frames() {
        return Frame.listAll();
    }

    @GET
    @Path("/{id}")
    @Produces(MediaType.APPLICATION_JSON)
    public Response frame(@PathParam("id") Long id) {
        Frame frame = Frame.findById(id);
        if (frame == null) {
            return Response.status(Response.Status.NOT_FOUND).build();
        }
        return Response.ok(frame).build();
    }

    @GET
    @Path("/{id}/preview")
    @Produces("image/jpeg")
    public Response preview(@PathParam("id") Long id) {
        Frame frame = Frame.findById(id);
        if (frame == null || frame.previewStorageKey == null) {
            return Response.status(Response.Status.NOT_FOUND).build();
        }
        byte[] image = storageService.get("previews", frame.previewStorageKey);
        return Response.ok(image).build();
    }

    @GET
    @Path("/{id}/thumbnail")
    @Produces("image/jpeg")
    public Response thumbnail(@PathParam("id") Long id) {
        Frame frame = Frame.findById(id);
        if (frame == null || frame.thumbnailStorageKey == null) {
            return Response.status(Response.Status.NOT_FOUND).build();
        }
        byte[] image = storageService.get("thumbnails", frame.thumbnailStorageKey);
        return Response.ok(image).build();
    }

    @GET
    @Path("/{id}/jobs")
    @Produces(MediaType.APPLICATION_JSON)
    public Response frameJobs(@PathParam("id") Long id) {
        Frame frame = Frame.findById(id);
        if (frame == null) {
            return Response.status(Response.Status.NOT_FOUND).build();
        }
        return Response.ok(ProcessingJob.list("frameId = ?1 order by createdAt desc nulls last, id desc", id)).build();
    }

    @DELETE
    @Path("/{id}")
    @Transactional
    @RolesAllowed({"ADMIN", "USER"})
    public Response deleteFrame(@PathParam("id") Long id) {
        Frame frame = Frame.findById(id);
        if (frame == null) {
            return Response.status(Response.Status.NOT_FOUND).build();
        }
        ProcessingJob.delete("frameId", id);
        if (frame.storageKey != null) {
            storageService.delete("raw", frame.storageKey);
        }
        if (frame.previewStorageKey != null) {
            storageService.delete("previews", frame.previewStorageKey);
        }
        if (frame.thumbnailStorageKey != null) {
            storageService.delete("thumbnails", frame.thumbnailStorageKey);
        }
        frame.delete();
        return Response.noContent().build();
    }

    @POST
    @Path("/{frameId}/move-to-session/{sessionId}")
    @Transactional
    @RolesAllowed({"ADMIN", "USER"})
    public Response moveToSession(@PathParam("frameId") Long frameId, @PathParam("sessionId") Long sessionId) {
        Frame frame = Frame.findById(frameId);
        if (frame == null) {
            return Response.status(Response.Status.NOT_FOUND).entity("Frame not found").build();
        }
        ImagingSession target = ImagingSession.findById(sessionId);
        if (target == null) {
            return Response.status(Response.Status.NOT_FOUND).entity("Session not found").build();
        }
        ImagingSession old = frame.session;
        frame.session = target;
        if (old != null) {
            sessionAssignmentService.recalculateSession(old);
        }
        sessionAssignmentService.recalculateSession(target);
        return Response.ok(frame).build();
    }

    @POST
    @Path("/{frameId}/detach")
    @Transactional
    @RolesAllowed({"ADMIN", "USER"})
    public Response detach(@PathParam("frameId") Long frameId) {
        Frame frame = Frame.findById(frameId);
        if (frame == null) {
            return Response.status(Response.Status.NOT_FOUND).build();
        }
        ImagingSession old = frame.session;
        ImagingSession session = new ImagingSession();
        session.target = old == null ? null : old.target;
        session.notes = "Detached frame session";
        session.startTime = frame.observedAt;
        session.endTime = frame.observedAt;
        session.totalIntegrationTime = frame.frameType == FrameType.LIGHT && frame.exposureSeconds != null ? frame.exposureSeconds : 0L;
        session.persist();
        frame.session = session;
        if (old != null) {
            sessionAssignmentService.recalculateSession(old);
        }
        sessionAssignmentService.recalculateSession(session);
        return Response.ok(frame).build();
    }
}
