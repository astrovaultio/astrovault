package io.astrovault.jobs;

import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.inject.Produces;
import org.eclipse.microprofile.config.inject.ConfigProperty;

@ApplicationScoped
public class JobQueueProducer {
    @ConfigProperty(name = "astrovault.queue.mode", defaultValue = "inprocess")
    String mode;

    @ConfigProperty(name = "astrovault.rabbitmq.host", defaultValue = "localhost")
    String rabbitMqHost;

    @Produces
    @ApplicationScoped
    JobQueue jobQueue() {
        if ("rabbitmq".equalsIgnoreCase(mode)) {
            return new RabbitMqJobQueue(rabbitMqHost);
        }
        return new InProcessJobQueue();
    }
}
