package io.astrovault.jobs;

import io.astrovault.domain.ProcessingJob;
public class InProcessJobQueue implements JobQueue {
    @Override
    public void enqueue(ProcessingJob job) {
        // MVP: persisted jobs are visible and can be polled by embedded worker.
    }
}
