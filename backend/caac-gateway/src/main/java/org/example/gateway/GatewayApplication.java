package org.example.gateway;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.web.client.RestTemplateBuilder;
import org.springframework.context.annotation.Bean;
import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.web.client.RestTemplate;

import java.time.Duration;

/**
 * CAAC Gateway - Layer 3: Policy Enforcement Point (PEP)
 * @EnableScheduling activates Algorithm 2 (RevocationScheduler background task)
 */
@SpringBootApplication
@EnableScheduling
public class GatewayApplication {

    public static void main(String[] args) {
        SpringApplication.run(GatewayApplication.class, args);
    }

    /**
     * Outbound HTTP client with explicit timeouts.
     * Without these, a hung oracle / IPFS peer pins Tomcat workers indefinitely
     * (each call blocks the request thread until the OS TCP keepalive expires).
     * Connect=5s and read=10s are the upper bound for normal oracle latency
     * (P99 ~3s for the Fabric receipt-submit path).
     */
    @Bean
    public RestTemplate restTemplate(RestTemplateBuilder builder) {
        return builder
                .setConnectTimeout(Duration.ofSeconds(5))
                .setReadTimeout(Duration.ofSeconds(10))
                .build();
    }
}
