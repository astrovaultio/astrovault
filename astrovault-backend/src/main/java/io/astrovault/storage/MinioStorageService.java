package io.astrovault.storage;

import io.minio.BucketExistsArgs;
import io.minio.GetObjectArgs;
import io.minio.ListObjectsArgs;
import io.minio.MakeBucketArgs;
import io.minio.MinioClient;
import io.minio.PutObjectArgs;
import io.minio.RemoveObjectArgs;
import io.minio.Result;
import io.minio.messages.Item;
import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;

public class MinioStorageService implements StorageService {
    private final MinioClient client;

    MinioStorageService(String endpoint, String access, String secret) {
        client = MinioClient.builder().endpoint(endpoint).credentials(access, secret).build();
    }

    @Override
    public String put(String bucket, String key, byte[] content, String contentType) {
        return put(bucket, key, new ByteArrayInputStream(content), content.length, contentType);
    }

    @Override
    public String put(String bucket, String key, InputStream content, long size, String contentType) {
        try {
            ensureBucket(bucket);
            client.putObject(PutObjectArgs.builder().bucket(bucket).object(key)
                    .stream(content, size, -1L)
                    .contentType(contentType)
                    .build());
            return key;
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
    }

    @Override
    public byte[] get(String bucket, String key) {
        try (var stream = getStream(bucket, key)) {
            return stream.readAllBytes();
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
    }

    @Override
    public InputStream getStream(String bucket, String key) {
        try {
            return client.getObject(GetObjectArgs.builder().bucket(bucket).object(key).build());
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
    }

    @Override
    public void delete(String bucket, String key) {
        try {
            client.removeObject(RemoveObjectArgs.builder().bucket(bucket).object(key).build());
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
    }

    @Override
    public StorageUsage usage() {
        try {
            List<BucketUsage> buckets = new ArrayList<>();
            long totalUsed = 0L;
            for (String bucket : List.of("raw", "previews", "thumbnails", "processed", "exports")) {
                if (!client.bucketExists(BucketExistsArgs.builder().bucket(bucket).build())) {
                    buckets.add(new BucketUsage(bucket, 0L, 0L));
                    continue;
                }
                long objects = 0L;
                long used = 0L;
                Iterable<Result<Item>> results = client.listObjects(ListObjectsArgs.builder().bucket(bucket).recursive(true).build());
                for (Result<Item> result : results) {
                    Item item = result.get();
                    if (!item.isDir()) {
                        objects++;
                        used += Math.max(0L, item.size());
                    }
                }
                buckets.add(new BucketUsage(bucket, objects, used));
                totalUsed += used;
            }
            return new StorageUsage(totalUsed, null, null, buckets);
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
    }

    private void ensureBucket(String bucket) throws Exception {
        boolean exists = client.bucketExists(BucketExistsArgs.builder().bucket(bucket).build());
        if (!exists) {
            client.makeBucket(MakeBucketArgs.builder().bucket(bucket).build());
        }
    }
}
