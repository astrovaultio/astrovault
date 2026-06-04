package io.astrovault.storage;

import java.io.InputStream;
import java.util.List;

public interface StorageService {
    record BucketUsage(String bucket, long objects, long usedBytes) {}
    record StorageUsage(long usedBytes, Long freeBytes, Long totalBytes, List<BucketUsage> buckets) {}

    String put(String bucket, String key, byte[] content, String contentType);
    String put(String bucket, String key, InputStream content, long size, String contentType);
    byte[] get(String bucket, String key);
    InputStream getStream(String bucket, String key);
    void delete(String bucket, String key);
    StorageUsage usage();
}
