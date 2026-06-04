package io.astrovault.domain;

import io.quarkus.hibernate.orm.panache.PanacheEntity;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import java.time.Instant;

@Entity
public class ProcessingJob extends PanacheEntity {
    @Enumerated(EnumType.STRING)
    public JobType type;
    @Enumerated(EnumType.STRING)
    public JobStatus status;
    public Instant createdAt;
    public Instant startedAt;
    public Instant finishedAt;
    public String errorMessage;
    public Long frameId;
    public Long sessionId;
    public String resultStorageKey;
}
