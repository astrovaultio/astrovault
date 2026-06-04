package io.astrovault.jobs;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.rabbitmq.client.Channel;
import com.rabbitmq.client.Connection;
import com.rabbitmq.client.ConnectionFactory;
import com.rabbitmq.client.MessageProperties;
import io.astrovault.domain.ProcessingJob;
import io.quarkus.arc.lookup.LookupIfProperty;
import jakarta.annotation.PostConstruct;
import jakarta.enterprise.context.ApplicationScoped;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import java.util.HashMap;
import java.util.Map;

@ApplicationScoped
@LookupIfProperty(name = "astrovault.queue.mode", stringValue = "rabbitmq")
public class RabbitMqJobQueue implements JobQueue {

    @ConfigProperty(name = "astrovault.rabbitmq.host")
    String host;

    private final ObjectMapper mapper = new ObjectMapper();
    private ConnectionFactory factory;

    @PostConstruct
    void init() {
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
