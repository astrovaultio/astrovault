package io.astrovault.api;

import jakarta.ws.rs.FormParam;
import org.jboss.resteasy.annotations.providers.multipart.PartType;

import java.io.InputStream;

public class ProcessedAssetUploadForm {
    @FormParam("title")
    @PartType("text/plain")
    public String title;
    @FormParam("description")
    @PartType("text/plain")
    public String description;
    @FormParam("software")
    @PartType("text/plain")
    public String software;
    @FormParam("versionLabel")
    @PartType("text/plain")
    public String versionLabel;
    @FormParam("notes")
    @PartType("text/plain")
    public String notes;
    @FormParam("file")
    @PartType("application/octet-stream")
    public InputStream file;
    @FormParam("fileName")
    @PartType("text/plain")
    public String fileName;
    @FormParam("contentType")
    @PartType("text/plain")
    public String contentType;
    @FormParam("sessionIds")
    @PartType("text/plain")
    public String sessionIds;
}
