package io.astrovault.storage;

import org.eclipse.microprofile.config.inject.ConfigProperty;
import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.FileStore;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

public class FilesystemStorageService implements StorageService {

    @ConfigProperty(name = "astrovault.storage.base-path")
    String basePath;

    @Override
    public String put(String bucket, String key, byte[] content, String contentType) {
        try {
            Path path = Path.of(basePath, bucket, key);
            Files.createDirectories(path.getParent());
            Files.write(path, content);
            return path.toString();
        } catch (IOException e) {
            throw new RuntimeException(e);
        }
    }

    @Override
    public String put(String bucket, String key, InputStream content, long size, String contentType) {
        try {
            Path path = Path.of(basePath, bucket, key);
            Files.createDirectories(path.getParent());
            Files.copy(content, path, java.nio.file.StandardCopyOption.REPLACE_EXISTING);
            return path.toString();
        } catch (IOException e) {
            throw new RuntimeException(e);
        }
    }

    @Override
    public byte[] get(String bucket, String key) {
        try {
            return Files.readAllBytes(Path.of(basePath, bucket, key));
        } catch (IOException e) {
            throw new RuntimeException(e);
        }
    }

    @Override
    public InputStream getStream(String bucket, String key) {
        try {
            return Files.newInputStream(Path.of(basePath, bucket, key));
        } catch (IOException e) {
            throw new RuntimeException(e);
        }
    }

    @Override
    public void delete(String bucket, String key) {
        try {
            Files.deleteIfExists(Path.of(basePath, bucket, key));
        } catch (IOException e) {
            throw new RuntimeException(e);
        }
    }

    @Override
    public StorageUsage usage() {
        try {
            Path root = Path.of(basePath);
            Files.createDirectories(root);
            List<BucketUsage> buckets = new ArrayList<>();
            long totalUsed = 0L;
            for (String bucket : List.of("raw", "previews", "thumbnails", "processed", "exports")) {
                Path bucketPath = root.resolve(bucket);
                long objects = 0L;
                long used = 0L;
                if (Files.exists(bucketPath)) {
                    try (var stream = Files.walk(bucketPath)) {
                        var files = stream.filter(Files::isRegularFile).toList();
                        objects = files.size();
                        for (Path file : files) {
                            used += Files.size(file);
                        }
                    }
                }
                buckets.add(new BucketUsage(bucket, objects, used));
                totalUsed += used;
            }
            FileStore store = Files.getFileStore(root);
            return new StorageUsage(totalUsed, store.getUsableSpace(), store.getTotalSpace(), buckets);
        } catch (IOException e) {
            throw new RuntimeException(e);
        }
    }
}
