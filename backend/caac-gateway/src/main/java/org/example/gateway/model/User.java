package org.example.gateway.model;

import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonProperty;

import java.time.LocalDateTime;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

/**
 * User - CAAC system user with verification support.
 *
 * Improved security:
 *   - BCrypt password hashing (auto-migrated from SHA-256)
 *   - Email verification (token-based, SHA-256 hashed)
 *   - Phone verification (OTP-based, IP-bound)
 *   - Account lockout after failed login attempts
 *   - OTP IP binding (Security improvement #8)
 */
public class User {
    public enum Status { ACTIVE, PENDING, BLOCKED, UNVERIFIED }
    private String id;
    private String username;
    @JsonIgnore private String passwordHash;
    @JsonIgnore private String salt;
    private String displayName;
    private int rSub;
    private double tSub;
    private Status status;
    private LocalDateTime registeredAt;
    private LocalDateTime lastLoginAt;

    // Profile
    private String email;
    private String phone;
    private String organization;

    // Verification
    private boolean emailVerified;
    private boolean phoneVerified;
    @JsonIgnore private String verificationTokenHash;
    @JsonIgnore private LocalDateTime tokenExpiry;
    @JsonIgnore private String otpHash;
    @JsonIgnore private LocalDateTime otpExpiry;
    @JsonIgnore private int otpAttempts;

    // Login security
    @JsonIgnore private int failedLoginAttempts;
    @JsonIgnore private LocalDateTime lockedUntil;

    // OTP IP binding
    @JsonIgnore private String otpIp;

    public static final String[] ROLE_LABELS = { "", "Junior", "Staff", "Senior", "Manager", "Administrator" };
    public User() {}

    // New user constructor (UNVERIFIED until contact info is verified)
    public User(String username, String passwordHash, String salt, String displayName) {
        this.id = UUID.randomUUID().toString().substring(0, 8).toUpperCase();
        this.username = username;
        this.passwordHash = passwordHash;
        this.salt = salt;
        this.displayName = displayName;
        this.rSub = 1;
        this.tSub = 0.5;
        this.status = Status.UNVERIFIED;
        this.registeredAt = LocalDateTime.now();
        this.email = "";
        this.phone = "";
        this.organization = "";
        this.emailVerified = false;
        this.phoneVerified = false;
    }

    // Backward-compatible constructor (admin)
    public User(String username, String passwordHash, String displayName) {
        this(username, passwordHash, "", displayName);
        this.status = Status.ACTIVE;
        this.emailVerified = true;
        this.phoneVerified = true;
    }

    public String getId() { return id; }
    public void setId(String id) { this.id = id; }
    public String getUsername() { return username; }
    public void setUsername(String u) { this.username = u; }
    @JsonIgnore public String getPasswordHash() { return passwordHash; }
    public void setPasswordHash(String p) { this.passwordHash = p; }
    @JsonIgnore public String getSalt() { return salt; }
    public void setSalt(String s) { this.salt = s; }
    public String getDisplayName() { return displayName; }
    public void setDisplayName(String d) { this.displayName = d; }
    @JsonProperty("rSub") public int getRSub() { return rSub; }
    public void setRSub(int rSub) { this.rSub = rSub; }
    @JsonProperty("tSub") public double getTSub() { return tSub; }
    public void setTSub(double tSub) { this.tSub = tSub; }
    public Status getStatus() { return status; }
    public void setStatus(Status s) { this.status = s; }
    public LocalDateTime getRegisteredAt() { return registeredAt; }
    public void setRegisteredAt(LocalDateTime t) { this.registeredAt = t; }
    public LocalDateTime getLastLoginAt() { return lastLoginAt; }
    public void setLastLoginAt(LocalDateTime t) { this.lastLoginAt = t; }

    // Profile
    public String getEmail() { return email; }
    public void setEmail(String e) { this.email = e != null ? e : ""; }
    public String getPhone() { return phone; }
    public void setPhone(String p) { this.phone = p != null ? p : ""; }
    public String getOrganization() { return organization; }
    public void setOrganization(String o) { this.organization = o != null ? o : ""; }

    // Verification
    public boolean isEmailVerified() { return emailVerified; }
    public void setEmailVerified(boolean v) { this.emailVerified = v; }
    public boolean isPhoneVerified() { return phoneVerified; }
    public void setPhoneVerified(boolean v) { this.phoneVerified = v; }
    @JsonIgnore public String getVerificationTokenHash() { return verificationTokenHash; }
    public void setVerificationTokenHash(String t) { this.verificationTokenHash = t; }
    @JsonIgnore public LocalDateTime getTokenExpiry() { return tokenExpiry; }
    public void setTokenExpiry(LocalDateTime t) { this.tokenExpiry = t; }
    @JsonIgnore public String getOtpHash() { return otpHash; }
    public void setOtpHash(String o) { this.otpHash = o; }
    @JsonIgnore public LocalDateTime getOtpExpiry() { return otpExpiry; }
    public void setOtpExpiry(LocalDateTime t) { this.otpExpiry = t; }
    @JsonIgnore public int getOtpAttempts() { return otpAttempts; }
    public void setOtpAttempts(int a) { this.otpAttempts = a; }

    // Login security
    @JsonIgnore public int getFailedLoginAttempts() { return failedLoginAttempts; }
    public void setFailedLoginAttempts(int a) { this.failedLoginAttempts = a; }
    @JsonIgnore public LocalDateTime getLockedUntil() { return lockedUntil; }
    public void setLockedUntil(LocalDateTime t) { this.lockedUntil = t; }

    // OTP IP binding
    @JsonIgnore public String getOtpIp() { return otpIp; }
    public void setOtpIp(String ip) { this.otpIp = ip; }

    public boolean isLocked() {
        return lockedUntil != null && LocalDateTime.now().isBefore(lockedUntil);
    }

    // Check whether a user is fully verified
    public boolean isFullyVerified() {
        if ("admin".equals(username)) return true;
        boolean hasEmail = email != null && !email.isEmpty();
        boolean hasPhone = phone != null && !phone.isEmpty();
        if (hasEmail && !emailVerified) return false;
        if (hasPhone && !phoneVerified) return false;
        return hasEmail || hasPhone;
    }

    public String getRoleLabel() {
        return (rSub >= 1 && rSub <= 5) ? ROLE_LABELS[rSub] : "Unknown";
    }

    public Map<String, Object> toPublicMap() {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", id);
        m.put("username", username);
        m.put("displayName", displayName);
        m.put("rSub", rSub);
        m.put("roleLabel", getRoleLabel());
        m.put("tSub", tSub);
        m.put("status", status.name());
        m.put("email", maskEmail(email));
        m.put("phone", maskPhone(phone));
        m.put("organization", organization != null ? organization : "");
        m.put("emailVerified", emailVerified);
        m.put("phoneVerified", phoneVerified);
        m.put("registeredAt", registeredAt != null ? registeredAt.toString() : null);
        m.put("lastLoginAt", lastLoginAt != null ? lastLoginAt.toString() : null);
        return m;
    }

    private String maskEmail(String e) {
        if (e == null || e.isEmpty() || !e.contains("@")) return e != null ? e : "";
        int at = e.indexOf('@');
        return at <= 1 ? e : e.charAt(0) + "***" + e.substring(at);
    }

    private String maskPhone(String p) {
        if (p == null || p.length() < 6) return p != null ? p : "";
        return p.substring(0, 3) + "***" + p.substring(p.length() - 4);
    }
}
