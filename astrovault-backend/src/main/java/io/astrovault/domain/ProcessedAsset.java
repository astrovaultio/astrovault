package io.astrovault.domain;

import io.quarkus.hibernate.orm.panache.PanacheEntity;
import jakarta.persistence.Entity;
import jakarta.persistence.ManyToOne;
import java.time.Instant;

@Entity
public class ProcessedAsset extends PanacheEntity {
    @ManyToOne
    public ImagingSession session;
    @ManyToOne
    public Target target;
    public String title;
    public String description;
    public String storageKey;
    public String previewStorageKey;
    public String software;
    public String versionLabel;
    public String notes;
    public String checksum;
    public String uploadedBy;
    public Instant createdAt;
}
