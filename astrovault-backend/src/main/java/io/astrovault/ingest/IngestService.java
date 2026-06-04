package io.astrovault.ingest;

import io.astrovault.domain.Frame;
import io.astrovault.domain.FrameProcessingStatus;
import io.astrovault.domain.FrameType;
import io.astrovault.domain.ImagingSession;
import io.astrovault.domain.JobStatus;
import io.astrovault.domain.JobType;
import io.astrovault.domain.ProcessingJob;
import io.astrovault.jobs.JobQueue;
import io.astrovault.storage.StorageService;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import jakarta.transaction.Status;
import jakarta.transaction.Synchronization;
import jakarta.transaction.Transactional;
import jakarta.transaction.TransactionSynchronizationRegistry;
import org.jboss.logging.Logger;
import org.eclipse.microprofile.config.inject.ConfigProperty;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.FileTime;
import java.security.MessageDigest;
import java.time.Duration;
import java.time.Instant;
import java.util.HexFormat;
import java.util.List;

@ApplicationScoped
public class IngestService {

    private static final Logger LOG = Logger.getLogger(IngestService.class);

    @Inject
    StorageService storageService;

    @Inject
    JobQueue jobQueue;

    @Inject
    SessionAssignmentService sessionAssignmentService;

    @Inject
    TransactionSynchronizationRegistry txSyncRegistry;

    @ConfigProperty(name = "astrovault.ingest.file-stable-seconds", defaultValue = "20")
    long fileStableSeconds;

    @Transactional
    public int scanFolder(Path ingestFolder) {
        return scanFolder(new IngestSourceConfig("default", IngestSourceType.LOCAL_FOLDER, ingestFolder, true));
    }

    @Transactional
    public int scanFolder(IngestSourceConfig source) {
        Path ingestFolder = source.path();
        LOG.infof("Starting ingest scan source=%s type=%s path=%s", source.name(), source.type(), ingestFolder);
        if (!Files.exists(ingestFolder) || !Files.isDirectory(ingestFolder)) {
            LOG.warnf("Ingest path missing or not directory source=%s path=%s", source.name(), ingestFolder);
            return 0;
        }

        List<Path> fitsFiles;
        try (var stream = Files.list(ingestFolder)) {
            fitsFiles = stream
                    .filter(Files::isRegularFile)
                    .filter(this::isFits)
                    .toList();
        } catch (IOException e) {
            LOG.warnf("Skipping ingest scan for folder %s: %s", ingestFolder, e.getMessage());
            return 0;
        }

        int imported = 0;
        for (Path fitsPath : fitsFiles) {
            LOG.debugf("Inspecting ingest file source=%s file=%s", source.name(), fitsPath.getFileName());
            if (!isStable(fitsPath)) {
                LOG.debugf("Skipping unstable ingest file source=%s file=%s", source.name(), fitsPath.getFileName());
                continue;
            }
            byte[] content;
            try {
                content = Files.readAllBytes(fitsPath);
                if (!isStable(fitsPath)) {
                    LOG.debugf("Skipping ingest file changed during read source=%s file=%s", source.name(), fitsPath.getFileName());
                    continue;
                }
            } catch (IOException e) {
                if (!Files.exists(fitsPath)) {
                    LOG.debugf("Skipping vanished ingest file: %s", fitsPath.getFileName());
                } else {
                    LOG.warnf("Skipping unreadable ingest file %s: %s", fitsPath.getFileName(), e.getMessage());
                }
                continue;
            }

            String checksum = checksum(content);
            if (Frame.count("checksum", checksum) > 0) {
                LOG.debugf("Skipping duplicate frame source=%s file=%s checksum=%s", source.name(), fitsPath.getFileName(), checksum);
                continue;
            }

            String storageKey = checksum + "-" + fitsPath.getFileName();
            storageService.put("raw", storageKey, content, "application/fits");

            Instant fallbackObservedAt;
            try {
                fallbackObservedAt = Files.getLastModifiedTime(fitsPath).toInstant();
            } catch (IOException e) {
                fallbackObservedAt = Instant.now();
            }
            ImagingSession assignedSession = sessionAssignmentService.unassignedSession();

            Frame frame = new Frame();
            frame.session = assignedSession;
            frame.originalFilename = fitsPath.getFileName().toString();
            frame.storageKey = storageKey;
            frame.checksum = checksum;
            frame.sourceName = source.name();
            frame.observedAt = fallbackObservedAt;
            frame.frameType = FrameType.LIGHT;
            frame.processingStatus = FrameProcessingStatus.PENDING;
            frame.persist();
            LOG.infof("Imported frame id=%s file=%s session=%s status=%s", frame.id, frame.originalFilename, assignedSession.id, frame.processingStatus);

            createJob(JobType.METADATA_EXTRACTION, frame.id);
            createJob(JobType.PREVIEW_GENERATION, frame.id);
            imported++;
        }
        LOG.infof("Finished ingest scan source=%s imported=%s candidates=%s", source.name(), imported, fitsFiles.size());
        return imported;
    }

    private boolean isFits(Path p) {
        String name = p.getFileName().toString().toLowerCase();
        return name.endsWith(".fits") || name.endsWith(".fit") || name.endsWith(".fts");
    }

    private boolean isStable(Path p) {
        try {
            long size = Files.size(p);
            FileTime modified = Files.getLastModifiedTime(p);
            if (size <= 0) {
                return false;
            }
            Duration age = Duration.between(modified.toInstant(), Instant.now());
            return age.getSeconds() >= fileStableSeconds;
        } catch (IOException e) {
            LOG.warnf("Unable to stat ingest file %s: %s", p.getFileName(), e.getMessage());
            return false;
        }
    }

    private String checksum(byte[] bytes) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            return HexFormat.of().formatHex(digest.digest(bytes));
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
    }

    private void createJob(JobType type, Long frameId) {
        ProcessingJob job = new ProcessingJob();
        job.type = type;
        job.status = JobStatus.PENDING;
        job.createdAt = Instant.now();
        job.frameId = frameId;
        job.persistAndFlush();
        LOG.infof("Enqueueing job id=%s type=%s frameId=%s", job.id, job.type, frameId);
        txSyncRegistry.registerInterposedSynchronization(new Synchronization() {
            @Override
            public void beforeCompletion() {
            }

            @Override
            public void afterCompletion(int status) {
                if (status == Status.STATUS_COMMITTED) {
                    jobQueue.enqueue(job);
                } else {
                    LOG.warnf("Skipping queue publish for rolled back job id=%s status=%s", job.id, status);
                }
            }
        });
    }
}
