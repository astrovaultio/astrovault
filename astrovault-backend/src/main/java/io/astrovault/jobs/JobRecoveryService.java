package io.astrovault.jobs;

import io.astrovault.domain.Frame;
import io.astrovault.domain.FrameProcessingStatus;
import io.astrovault.domain.JobStatus;
import io.astrovault.domain.JobType;
import io.astrovault.domain.ProcessingJob;
import io.quarkus.scheduler.Scheduled;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import jakarta.transaction.Transactional;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.jboss.logging.Logger;

import java.time.Duration;
import java.time.Instant;
import java.util.List;

@ApplicationScoped
public class JobRecoveryService {
    private static final Logger LOG = Logger.getLogger(JobRecoveryService.class);
    private static final List<JobType> FRAME_JOB_TYPES = List.of(JobType.METADATA_EXTRACTION, JobType.PREVIEW_GENERATION);
    private static final List<JobType> TARGET_JOB_TYPES = List.of(JobType.TARGET_ENRICHMENT);

    @Inject
    JobQueue jobQueue;

    @ConfigProperty(name = "astrovault.jobs.running-timeout-minutes")
    long runningTimeoutMinutes;

    @Scheduled(every = "60s")
    @Transactional
    public void recoverFrameJobs() {
        List<ProcessingJob> pending = ProcessingJob.list("status = ?1 and type in ?2 and frameId is not null", JobStatus.PENDING, FRAME_JOB_TYPES);
        for (ProcessingJob job : pending) {
            enqueue(job, "pending");
        }

        Instant cutoff = Instant.now().minus(Duration.ofMinutes(Math.max(1, runningTimeoutMinutes)));
        List<ProcessingJob> staleRunning = ProcessingJob.list(
                "status = ?1 and type in ?2 and frameId is not null and startedAt is not null and startedAt < ?3",
                JobStatus.RUNNING,
                FRAME_JOB_TYPES,
                cutoff
        );
        for (ProcessingJob job : staleRunning) {
            LOG.warnf("Recovering stale running job jobId=%s type=%s frameId=%s startedAt=%s", job.id, job.type, job.frameId, job.startedAt);
            job.status = JobStatus.PENDING;
            job.startedAt = null;
            job.finishedAt = null;
            job.errorMessage = null;
            Frame frame = Frame.findById(job.frameId);
            if (frame != null) {
                frame.processingStatus = FrameProcessingStatus.PENDING;
            }
            enqueue(job, "stale-running");
        }

        List<ProcessingJob> pendingTargets = ProcessingJob.list("status = ?1 and type in ?2 and targetId is not null", JobStatus.PENDING, TARGET_JOB_TYPES);
        for (ProcessingJob job : pendingTargets) {
            enqueue(job, "pending-target");
        }

        List<ProcessingJob> staleRunningTargets = ProcessingJob.list(
                "status = ?1 and type in ?2 and targetId is not null and startedAt is not null and startedAt < ?3",
                JobStatus.RUNNING,
                TARGET_JOB_TYPES,
                cutoff
        );
        for (ProcessingJob job : staleRunningTargets) {
            LOG.warnf("Recovering stale running target job jobId=%s type=%s targetId=%s startedAt=%s", job.id, job.type, job.targetId, job.startedAt);
            job.status = JobStatus.PENDING;
            job.startedAt = null;
            job.finishedAt = null;
            job.errorMessage = null;
            enqueue(job, "stale-running-target");
        }
    }

    private void enqueue(ProcessingJob job, String reason) {
        try {
            jobQueue.enqueue(job);
            LOG.debugf("Re-enqueued %s frame job jobId=%s type=%s frameId=%s", reason, job.id, job.type, job.frameId);
        } catch (Exception e) {
            LOG.errorf(e, "Unable to re-enqueue %s frame job jobId=%s type=%s frameId=%s", reason, job.id, job.type, job.frameId);
        }
    }
}
