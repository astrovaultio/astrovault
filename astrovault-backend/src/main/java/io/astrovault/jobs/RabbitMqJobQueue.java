package io.astrovault.jobs;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.rabbitmq.client.Channel;
import com.rabbitmq.client.Connection;
import com.rabbitmq.client.ConnectionFactory;
import com.rabbitmq.client.MessageProperties;
import io.astrovault.domain.ProcessingJob;
import java.util.HashMap;
import java.util.Map;

public class RabbitMqJobQueue implements JobQueue {

    private final ObjectMapper mapper = new ObjectMapper();
    private ConnectionFactory factory;

    RabbitMqJobQueue(String host) {
        factory = new ConnectionFactory();
        factory.setHost(host);
    }

    @Override
    public void enqueue(ProcessingJob job) {
        RuntimeException last = null;
        for (int attempt = 1; attempt <= 5; attempt++) {
            try (Connection conn = factory.newConnection(); Channel ch = conn.createChannel()) {
                ch.queueDeclare("astrovault.jobs", true, false, false, null);
                Map<String, Object> payload = new HashMap<>();
                payload.put("id", job.id);
                payload.put("type", job.type.name());
                payload.put("status", job.status.name());
                payload.put("frameId", job.frameId);
                payload.put("targetId", job.targetId);
                ch.basicPublish("", "astrovault.jobs", MessageProperties.PERSISTENT_TEXT_PLAIN, mapper.writeValueAsBytes(payload));
                return;
            } catch (Exception e) {
                last = new RuntimeException(e);
                try {
                    Thread.sleep(1000L * attempt);
                } catch (InterruptedException interrupted) {
                    Thread.currentThread().interrupt();
                    throw last;
                }
            }
        }
        throw last;
    }
}
