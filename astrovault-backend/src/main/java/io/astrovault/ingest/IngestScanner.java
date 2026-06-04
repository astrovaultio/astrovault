package io.astrovault.ingest;

import io.quarkus.scheduler.Scheduled;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import org.eclipse.microprofile.config.inject.ConfigProperty;

import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

@ApplicationScoped
public class IngestScanner {

    @ConfigProperty(name = "astrovault.ingest.path")
    String ingestPath;

    @ConfigProperty(name = "astrovault.ingest.sources", defaultValue = "")
    String ingestSources;

    @Inject
    IngestService ingestService;

    @Scheduled(every = "5s")
    void scan() {
        for (IngestSourceConfig source : sources()) {
            if (source.enabled()) {
                ingestService.scanFolder(source);
            }
        }
    }

    private List<IngestSourceConfig> sources() {
        if (ingestSources == null || ingestSources.isBlank()) {
            return List.of(new IngestSourceConfig("default", IngestSourceType.LOCAL_FOLDER, Path.of(ingestPath), true));
        }
        List<IngestSourceConfig> out = new ArrayList<>();
        for (String raw : ingestSources.split(";")) {
            String[] parts = raw.split("\\|", -1);
            if (parts.length < 4) {
                continue;
            }
            out.add(new IngestSourceConfig(
                    parts[0].trim(),
                    IngestSourceType.valueOf(parts[1].trim()),
                    Path.of(parts[2].trim()),
                    Boolean.parseBoolean(parts[3].trim())
            ));
        }
        return out.isEmpty() ? List.of(new IngestSourceConfig("default", IngestSourceType.LOCAL_FOLDER, Path.of(ingestPath), true)) : out;
    }
}
