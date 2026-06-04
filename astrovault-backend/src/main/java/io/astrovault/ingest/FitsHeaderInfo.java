package io.astrovault.ingest;

import java.time.Instant;

public record FitsHeaderInfo(String objectName, String cameraName, Instant dateObs, Long exposureSeconds) {
}
