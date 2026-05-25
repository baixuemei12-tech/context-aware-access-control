package org.example.gateway.service;

import org.springframework.stereotype.Service;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * RateLimitService - In-memory rate limiter.
 * Used for: registration (per IP), login attempts (per username), OTP/email resend (per user), verification attempts
 */
@Service
public class RateLimitService {

    private final Map<String, long[]> counters = new ConcurrentHashMap<>();
    private final Map<String, Long> cooldowns = new ConcurrentHashMap<>();
    
    /**
     * Checks if action is allowed, returns true if within limit.
     *
     * Was a single synchronized method on the whole service — every distinct
     * key (every IP, every username) blocked every other one. Now uses
     * ConcurrentHashMap.compute, which locks only the bin for THIS key, so
     * unrelated keys execute in parallel.
     *
     * @param key Unique key (e.g., "reg:192.168.1.1" or "login:admin")
     * @param maxHits Max allowed within the window
     * @param windowMs Time window in milliseconds
     */
    public boolean isAllowed(String key, int maxHits, long windowMs) {
        long now = System.currentTimeMillis();
        boolean[] allowed = new boolean[]{false};
        counters.compute(key, (k, existing) -> {
            long[] prev = existing != null ? existing : new long[0];
            int aliveCount = 0;
            for (long t : prev) {
                if (now - t < windowMs) aliveCount++;
            }
            if (aliveCount >= maxHits) {
                allowed[0] = false;
                // Re-write a compacted array so stale entries don't grow forever.
                long[] alive = new long[aliveCount];
                int j = 0;
                for (long t : prev) if (now - t < windowMs) alive[j++] = t;
                return alive;
            }
            long[] next = new long[aliveCount + 1];
            int j = 0;
            for (long t : prev) if (now - t < windowMs) next[j++] = t;
            next[j] = now;
            allowed[0] = true;
            return next;
        });
        return allowed[0];
    }

    /**
     * Checks if a cooldown is active
     * @param key Unique key
     * @param cooldownMs Cooldown period in ms
     * @return seconds remaining, or 0 if no cooldown
     */
    public long getCooldownRemaining(String key, long cooldownMs) {
        Long lastTime = cooldowns.get(key);
        if (lastTime == null) return 0;
        long elapsed = System.currentTimeMillis() - lastTime;
        if (elapsed >= cooldownMs) return 0;
        return (cooldownMs - elapsed) / 1000;
    }

    public void setCooldown(String key) {
        cooldowns.put(key, System.currentTimeMillis());
    }

    public int getCount(String key, long windowMs) {
        long now = System.currentTimeMillis();
        long[] timestamps = counters.getOrDefault(key, new long[0]);
        int count = 0;
        for (long t : timestamps) {
            if (now - t < windowMs) count++;
        }
        return count;
    }

    public void reset(String key) {
        counters.remove(key);
        cooldowns.remove(key);
    }
}
