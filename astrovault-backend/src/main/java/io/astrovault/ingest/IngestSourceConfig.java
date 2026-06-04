package io.astrovault.ingest;

import java.nio.file.Path;

public record IngestSourceConfig(String name, IngestSourceType type, Path path, boolean enabled) {}
