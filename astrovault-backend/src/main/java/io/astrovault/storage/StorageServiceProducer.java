package io.astrovault.storage;

import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.inject.Produces;
import org.eclipse.microprofile.config.inject.ConfigProperty;

@ApplicationScoped
public class StorageServiceProducer {
    @ConfigProperty(name = "astrovault.storage.mode", defaultValue = "filesystem")
    String mode;

    @ConfigProperty(name = "astrovault.storage.base-path", defaultValue = "data")
    String basePath;

    @ConfigProperty(name = "astrovault.minio.endpoint", defaultValue = "http://localhost:9000")
    String minioEndpoint;

    @ConfigProperty(name = "astrovault.minio.access-key", defaultValue = "astrovault")
    String minioAccessKey;

    @ConfigProperty(name = "astrovault.minio.secret-key", defaultValue = "astrovault123")
    String minioSecretKey;

    @Produces
    @ApplicationScoped
    StorageService storageService() {
        if ("minio".equalsIgnoreCase(mode)) {
            return new MinioStorageService(minioEndpoint, minioAccessKey, minioSecretKey);
        }
        return new FilesystemStorageService(basePath);
    }
}
