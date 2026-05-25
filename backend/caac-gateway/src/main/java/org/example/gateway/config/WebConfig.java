package org.example.gateway.config;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;
import java.util.Arrays;

/**
 * WebConfig - CORS Configuration for Gateway
 * Restricts CORS to explicit trusted origins.
 */
@Configuration
public class WebConfig implements WebMvcConfigurer {

    @Value("${app.cors.allowed-origins:http://localhost:5052,http://127.0.0.1:5052,http://localhost:5173,http://127.0.0.1:5173}")
    private String allowedOrigins;

    @Override
    public void addCorsMappings(CorsRegistry registry) {
        registry.addMapping("/api/**")
                .allowedOrigins(resolveAllowedOrigins())
                .allowedMethods("GET", "POST", "OPTIONS")
                .allowedHeaders("*")
                // Required for the additive HttpOnly auth cookie to be sent
                // from the frontend on cross-origin fetch (when the frontend
                // moves to credentials:'include'). Allowed origins above are
                // already an exact-match allowlist, so this is safe.
                .allowCredentials(true)
                .exposedHeaders(
                    "X-CAAC-Decision",
                    "X-CAAC-Session-ID",
                    "X-CAAC-Latency-Ms",
                    "X-CAAC-IPFS-CID",
                    "X-CAAC-DT-Score",
                    "X-CAAC-CE-Score",
                    "X-CAAC-File-Type",
                    "X-CAAC-Algorithm2",
                    "X-CAAC-Risk-Margin",
                    "X-CAAC-Chunk-Delay",
                    "X-CAAC-Chunk-Size",
                    "X-CAAC-Window-Budget",
                    "Content-Disposition",
                    "X-Resolved-LTrust",
                    "X-Resolved-NStatus",
                    "X-Resolved-DSec",
                    "X-Resolved-TReq"
                );
    }

    private String[] resolveAllowedOrigins() {
        String[] origins = Arrays.stream(allowedOrigins.split(","))
                .map(String::trim)
                .filter(origin -> !origin.isEmpty())
                .toArray(String[]::new);
        if (origins.length == 0) {
            throw new IllegalStateException("app.cors.allowed-origins must contain at least one origin");
        }
        return origins;
    }
}
