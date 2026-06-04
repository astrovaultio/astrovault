package io.astrovault.jobs;

import io.astrovault.domain.ProcessingJob;

public interface JobQueue {
    void enqueue(ProcessingJob job);
}
