package io.astrovault.domain;

import io.quarkus.hibernate.orm.panache.PanacheEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.OneToOne;
import java.time.Instant;

@Entity
public class TargetEnrichment extends PanacheEntity {
    @OneToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "target_id", nullable = false, unique = true)
    public Target target;

    public String canonicalName;
    public String objectType;

    @Column(columnDefinition = "TEXT")
    public String catalogIds;

    public String constellation;
    public Double ra;
    public Double dec;
    public Double magnitude;
    public String apparentSize;
    public String distance;

    @Column(columnDefinition = "TEXT")
    public String description;

    public String source;

    @Column(columnDefinition = "TEXT")
    public String sourceReference;

    public Instant lastUpdated;
}
