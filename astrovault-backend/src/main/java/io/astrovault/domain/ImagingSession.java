package io.astrovault.domain;

import io.quarkus.hibernate.orm.panache.PanacheEntity;
import jakarta.persistence.Entity;
import jakarta.persistence.ManyToOne;
import java.time.Instant;

@Entity
public class ImagingSession extends PanacheEntity {
    @ManyToOne
    public Target target;
    public Instant startTime;
    public Instant endTime;
    public String notes;
    public Long totalIntegrationTime;
    public String logicalGroupKey;
    public String manualWorkflowStatus;
}
