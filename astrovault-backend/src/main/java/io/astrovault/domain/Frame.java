package io.astrovault.domain;

import io.quarkus.hibernate.orm.panache.PanacheEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.ManyToOne;

import java.time.Instant;

@Entity
public class Frame extends PanacheEntity {
    @ManyToOne
    public ImagingSession session;
    @Enumerated(EnumType.STRING)
    public FrameType frameType;
    @Enumerated(EnumType.STRING)
    public FrameProcessingStatus processingStatus;
    public String originalFilename;
    public String storageKey;
    public String checksum;
    @Column(columnDefinition = "TEXT")
    public String sourceName;
    public String cameraName;
    public Instant observedAt;
    public Long exposureSeconds;
    public String previewStorageKey;
    public String thumbnailStorageKey;
    @Column(columnDefinition = "TEXT")
    public String metadata;
}
