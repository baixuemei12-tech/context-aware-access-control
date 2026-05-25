package org.example.gateway.service;

import org.example.gateway.model.User;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import java.io.*;
import java.nio.file.*;
import java.security.SecureRandom;
import java.time.LocalDateTime;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Pattern;

/**
 * UserService - Security Enhancements & Credential Migration
 *
 * Persistence format (pipe-delimited, 17 fields — added otpIp):
 * username|passwordHash|displayName|rSub|tSub|status|id|email|phone|org|
 * salt|emailVerified|phoneVerified|failedLogins|lockedUntil|registeredAt|otpIp
 */
@Service
public class UserService {

    private final Map<String, User> users = new ConcurrentHashMap<>();
    private final Map<String, String> tokens = new ConcurrentHashMap<>(); // token -> username
    private final Map<String, Long> tokenCreatedAt = new ConcurrentHashMap<>(); // token -> creation timestamp
    private final Map<String, Long> onlineUsers = new ConcurrentHashMap<>();
    private static final long ONLINE_TIMEOUT_MS = 60_000;
    private static final long TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
    private static final String DATA_DIR = "data";
    private static final String USERS_FILE = "data/users.dat";
    private static final SecureRandom SECURE_RANDOM = new SecureRandom();
    private static final int MAX_FAILED_LOGINS = 5;
    private static final int LOCKOUT_MINUTES = 30;
    private static final int MIN_PASSWORD_LENGTH = 8;
    private static final Pattern USERNAME_PATTERN = Pattern.compile("^[a-zA-Z0-9._-]{3,32}$");
    private static final String ADMIN_BOOTSTRAP_ENV = "CAAC_INITIAL_ADMIN_PASSWORD";
    @Value("${phone.verification.enabled:false}")
    private boolean phoneVerificationEnabled;
    @Value("${app.registration.admin-approval.required:false}")
    private boolean adminApprovalRequired;
    private final Map<String, String> otpIpBinding = new ConcurrentHashMap<>();
    private final Map<String, String> pendingResets = new ConcurrentHashMap<>();
    private final Map<String, Long> pendingResetExpiry = new ConcurrentHashMap<>();
    

    public UserService() {
        try { Files.createDirectories(Paths.get(DATA_DIR)); } catch (Exception ignored) {}
        boolean loaded = loadFromDisk();
        String bootstrapAdminPassword = System.getenv(ADMIN_BOOTSTRAP_ENV);

        if (!users.containsKey("admin")) {
            if (!isPasswordPolicyCompliant(bootstrapAdminPassword)) {
                throw new IllegalStateException(
                        "Admin bootstrap password is missing or weak. Set " + ADMIN_BOOTSTRAP_ENV
                                + " to a strong password before starting.");
            }
            User admin = new User("admin", SecurityUtils.bcryptHash(bootstrapAdminPassword), "", "System Administrator");
            admin.setRSub(5);
            admin.setTSub(1.0);
            admin.setStatus(User.Status.ACTIVE);
            admin.setEmailVerified(true);
            admin.setPhoneVerified(true);
            users.put("admin", admin);
            saveToDisk();
        }
        User existingAdmin = users.get("admin");
        if (existingAdmin != null && verifyPassword(existingAdmin, "admin123")) {
            if (!isPasswordPolicyCompliant(bootstrapAdminPassword)) {
                throw new IllegalStateException(
                        "Insecure default admin password detected. Set " + ADMIN_BOOTSTRAP_ENV
                                + " to a strong password to rotate it.");
            }
            existingAdmin.setPasswordHash(SecurityUtils.bcryptHash(bootstrapAdminPassword));
            existingAdmin.setSalt("bcrypt");
            saveToDisk();
            System.out.println("[UserService] Rotated insecure default admin password from environment.");
        }

        System.out.println("[UserService] " + (loaded ? "Loaded " + users.size() + " users from disk (BCrypt migration active)"
                : "Initialized with default admin (BCrypt)"));
    }

    // ================================================================
    // PASSWORD VERIFICATION
    // ================================================================

    // Verifies a password against the stored hash
    private boolean verifyPassword(User user, String password) {
        String storedHash = user.getPasswordHash();
        if (SecurityUtils.isBcryptHash(storedHash)) {
            return SecurityUtils.bcryptCheck(password, storedHash);
        }

        boolean legacyMatch = false;
        if (user.getSalt() != null && !user.getSalt().isEmpty()) {
            legacyMatch = storedHash.equals(SecurityUtils.sha256WithSalt(password, user.getSalt()));
        }
        if (!legacyMatch) {
            legacyMatch = storedHash.equals(SecurityUtils.sha256WithSalt(password, ""));
        }

        if (legacyMatch) {
            String bcryptHash = SecurityUtils.bcryptHash(password);
            user.setPasswordHash(bcryptHash);
            user.setSalt("bcrypt");
            saveToDisk();
            System.out.println("[UserService] AUTO-MIGRATED " + user.getUsername()+ " from SHA-256 -> BCrypt");
        }

        return legacyMatch;
    }

    // ================================================================
    // TOKEN HASHING
    // ================================================================

    public String hashToken(String token) {
        return SecurityUtils.sha256(token);
    }

    // ================================================================
    // REGISTRATION
    // ================================================================

    public User register(String username, String password, String displayName, String email, String phone) {
        if (!isValidUsername(username)) return null;
        if (!isPasswordPolicyCompliant(password)) return null;
        String cleanUsername = username.toLowerCase().trim();
        if (users.containsKey(cleanUsername)) return null;
        String bcryptHash = SecurityUtils.bcryptHash(password);
        User user = new User(cleanUsername, bcryptHash, "bcrypt", displayName);
        user.setEmail(email != null ? email.trim() : "");
        user.setPhone(phone != null ? phone.trim() : "");
        users.put(cleanUsername, user);
        saveToDisk();
        System.out.println("[UserService] Registered (UNVERIFIED, BCrypt): " + cleanUsername);
        return user;
    }

    // ================================================================
    // EMAIL VERIFICATION
    // ================================================================

    // Generates an email verification token and returns raw token
    public String generateEmailToken(String username) {
        User user = users.get(username.toLowerCase());
        if (user == null) return null;
        String rawToken = UUID.randomUUID().toString();
        user.setVerificationTokenHash(hashToken(rawToken));
        user.setTokenExpiry(LocalDateTime.now().plusMinutes(15));
        saveToDisk();
        System.out.println("[UserService] Email token generated for " + username + " (expires in 15 min)");
        return rawToken;
    }

    public boolean verifyEmailToken(String username, String rawToken) {
        User user = users.get(username.toLowerCase());
        if (user == null) return false;
        if (user.getVerificationTokenHash() == null) return false;
        if (user.getTokenExpiry() == null || LocalDateTime.now().isAfter(user.getTokenExpiry())) {
            System.out.println("[UserService] Token expired for " + username);
            return false;
        }

        String hashed = hashToken(rawToken);
        if (!SecurityUtils.constantTimeEquals(hashed, user.getVerificationTokenHash())) return false;
        user.setEmailVerified(true);
        user.setVerificationTokenHash(null);
        user.setTokenExpiry(null);
        activateIfVerified(user);
        saveToDisk();

        System.out.println("[UserService] Email verified: " + username);
        return true;
    }

    // ================================================================
    // PHONE OTP VERIFICATION
    // ================================================================


    // Generates 6-digit OTP, returns raw OTP
    // Stores hashed version, max 3 verification attempts.
    public String generateOtp(String username, String clientIp) {
        User user = users.get(username.toLowerCase());
        if (user == null) return null;
        String otp = String.format("%06d", SECURE_RANDOM.nextInt(1_000_000));
        user.setOtpHash(hashToken(otp));
        user.setOtpExpiry(LocalDateTime.now().plusMinutes(5));
        user.setOtpAttempts(0);
        if (clientIp != null && !clientIp.isEmpty()) {
            otpIpBinding.put(username.toLowerCase(), clientIp);
            user.setOtpIp(clientIp);
        }

        saveToDisk();
        System.out.println("[UserService] ========================================");
        System.out.println("[UserService] OTP for " + username + ": " + otp);
        System.out.println("[UserService] Bound to IP: " + clientIp);
        System.out.println("[UserService] (Expires in 5 minutes, max 3 attempts)");
        System.out.println("[UserService] ========================================");
        return otp;
    }

    public String generateOtp(String username) {
        return generateOtp(username, null);
    }


    public String verifyOtp(String username, String submittedOtp, String clientIp) {
        User user = users.get(username.toLowerCase());
        if (user == null) return "wrong";
        if (user.getOtpHash() == null) return "wrong";
        if (user.getOtpAttempts() >= 3) {
            System.out.println("[UserService] OTP locked (max attempts) for " + username);
            return "locked";
        }
        if (user.getOtpExpiry() == null || LocalDateTime.now().isAfter(user.getOtpExpiry())) {
            return "expired";
        }

        String boundIp = otpIpBinding.get(username.toLowerCase());
        if (boundIp == null) boundIp = user.getOtpIp();
        if (boundIp != null && !boundIp.isEmpty() && clientIp != null && !clientIp.isEmpty() && !boundIp.equals(clientIp)) {
            System.out.println("[UserService] OTP IP mismatch for " + username + ": bound=" + boundIp + ", request=" + clientIp);
            return "ip_mismatch";
        }

        user.setOtpAttempts(user.getOtpAttempts() + 1);
        if (!SecurityUtils.constantTimeEquals(hashToken(submittedOtp), user.getOtpHash())) {
            saveToDisk();
            System.out.println("[UserService] Wrong OTP attempt " + user.getOtpAttempts() + "/3 for " + username);
            return "wrong";
        }

        user.setPhoneVerified(true);
        user.setOtpHash(null);
        user.setOtpExpiry(null);
        user.setOtpAttempts(0);
        user.setOtpIp(null);
        otpIpBinding.remove(username.toLowerCase());
        activateIfVerified(user);
        saveToDisk();
        System.out.println("[UserService] Phone verified: " + username);
        return "ok";
    }

    public String verifyOtp(String username, String submittedOtp) {
        return verifyOtp(username, submittedOtp, null);
    }

    private void activateIfVerified(User user) {
        if (user.getStatus() != User.Status.UNVERIFIED) return;
        boolean hasEmail = user.getEmail() != null && !user.getEmail().isEmpty();
        if (!hasEmail || !user.isEmailVerified()) return;
        if (phoneVerificationEnabled) {
            boolean hasPhone = user.getPhone() != null && !user.getPhone().isEmpty();
            if (hasPhone && !user.isPhoneVerified()) return;
        }
        if (adminApprovalRequired) {
            user.setStatus(User.Status.PENDING);
            System.out.println("[UserService] User pending admin approval: " + user.getUsername());
        } else {
            user.setStatus(User.Status.ACTIVE);
            System.out.println("[UserService] User ACTIVATED: " + user.getUsername());
        }
    }

    // ================================================================
    // LOGIN / LOGOUT
    // ================================================================

    public String getLoginError(String username, String password) {
        if (username == null || password == null) return "Invalid credentials";
        User user = users.get(username.toLowerCase().trim());
        if (user == null) return "Invalid credentials";
        if (!verifyPassword(user, password)) {
            recordFailedLogin(user);
            return "Invalid credentials";
        }
        if (user.isLocked()) return "Account temporarily locked. Try again later.";
        if (user.getStatus() == User.Status.BLOCKED) return "Account blocked. Contact administrator.";
        if (user.getStatus() == User.Status.UNVERIFIED) return "Account not verified";
        if (user.getStatus() == User.Status.PENDING) return "Account pending administrator approval";
        if (user.getStatus() != User.Status.ACTIVE) return "Account is not active";
        return null;
    }

    public String login(String username, String password) {
        if (username == null || password == null) return null;
        User user = users.get(username.toLowerCase().trim());
        if (user == null) return null;
        if (user.getStatus() != User.Status.ACTIVE) return null;
        if (user.isLocked()) return null;
        if (!verifyPassword(user, password)) return null;
        user.setFailedLoginAttempts(0);
        user.setLockedUntil(null);
        String token = UUID.randomUUID().toString();
        tokens.put(token, user.getUsername());
        tokenCreatedAt.put(token, System.currentTimeMillis());
        user.setLastLoginAt(LocalDateTime.now());
        onlineUsers.put(user.getUsername(), System.currentTimeMillis());
        saveToDisk();
        System.out.println("[UserService] Login: " + username 
            + " | hash=" + (SecurityUtils.isBcryptHash(user.getPasswordHash()) ? "BCrypt" : "SHA-256(migrating)"));
        return token;
    }

    private void recordFailedLogin(User user) {
        user.setFailedLoginAttempts(user.getFailedLoginAttempts() + 1);
        if (user.getFailedLoginAttempts() >= MAX_FAILED_LOGINS) {
            user.setLockedUntil(LocalDateTime.now().plusMinutes(LOCKOUT_MINUTES));
            System.out.println("[UserService] LOCKED " + user.getUsername()
                    + " for " + LOCKOUT_MINUTES + " min (" + MAX_FAILED_LOGINS + " failed attempts)");
        }
        saveToDisk();
    }

    public int getFailedLoginCount(String username) {
        User user = users.get(username.toLowerCase().trim());
        return user != null ? user.getFailedLoginAttempts() : 0;
    }

    public void logout(String token) {
        String username = tokens.remove(token);
        tokenCreatedAt.remove(token);
        if (username != null) System.out.println("[UserService] Logout: " + username);
    }

    public User getUserByToken(String token) {
        if (token == null) return null;
        if (token.startsWith("Bearer ")) token = token.substring(7);
        String username = tokens.get(token);
        if (username == null) return null;
        Long created = tokenCreatedAt.get(token);
        if (created != null && (System.currentTimeMillis() - created) > TOKEN_TTL_MS) {
            tokens.remove(token);
            tokenCreatedAt.remove(token);
            System.out.println("[UserService] Token expired for " + username);
            return null;
        }
        onlineUsers.put(username, System.currentTimeMillis());
        return users.get(username);
    }

    // ================================================================
    // ADMIN: ROLE/TRUST/STATUS MANAGEMENT
    // ================================================================

    public boolean setUserRole(String targetUsername, int newRSub) {
        User target = users.get(targetUsername.toLowerCase());
        if (target == null || newRSub < 1 || newRSub > 5) return false;
        target.setRSub(newRSub);
        saveToDisk();
        return true;
    }

    public boolean setUserTrust(String targetUsername, double newTSub) {
        User target = users.get(targetUsername.toLowerCase());
        if (target == null) return false;
        target.setTSub(Math.max(0.0, Math.min(1.0, newTSub)));
        saveToDisk();
        return true;
    }

    public boolean setUserStatus(String targetUsername, User.Status status) {
        User target = users.get(targetUsername.toLowerCase());
        if (target == null) return false;
        target.setStatus(status);
        if (status == User.Status.BLOCKED) {
            tokens.entrySet().removeIf(e -> e.getValue().equals(targetUsername.toLowerCase()));
        }
        saveToDisk();
        return true;
    }

    public boolean updateProfile(String username, String displayName, String email, String phone, String org) {
        User user = users.get(username.toLowerCase());
        if (user == null) return false;
        if (displayName != null) user.setDisplayName(displayName);
        if (email != null) user.setEmail(email);
        if (phone != null) user.setPhone(phone);
        if (org != null) user.setOrganization(org);
        saveToDisk();
        return true;
    }

    // ================================================================
    // ADMIN PASSWORD CHANGE
    // ================================================================

    public boolean changePassword(String username, String currentPassword, String newPassword) {
        User user = users.get(username.toLowerCase());
        if (user == null) return false;
        if (!isPasswordPolicyCompliant(newPassword)) return false;
        if (!verifyPassword(user, currentPassword)) return false;
        user.setPasswordHash(SecurityUtils.bcryptHash(newPassword));
        user.setSalt("bcrypt");
        saveToDisk();
        System.out.println("[UserService] Password changed for " + username + " (BCrypt)");
        return true;
    }

    public boolean adminResetPassword(String targetUsername, String newPassword) {
        User target = users.get(targetUsername.toLowerCase());
        if (target == null) return false;
        if (!isPasswordPolicyCompliant(newPassword)) return false;
        target.setPasswordHash(SecurityUtils.bcryptHash(newPassword));
        target.setSalt("bcrypt");
        tokens.entrySet().removeIf(e -> e.getValue().equals(targetUsername.toLowerCase()));
        saveToDisk();
        System.out.println("[UserService] Admin reset password for " + targetUsername);
        return true;
    }


    public User findByUsername(String username) {
        return getUserByUsername(username);
    }
    
    public String setPendingReset(String username) {
        String lower = username.toLowerCase();
        Long existingExpiry = pendingResetExpiry.get(lower);
        if (existingExpiry != null) {
            long timeRemaining = existingExpiry - System.currentTimeMillis();
            if (timeRemaining > 28 * 60 * 1000) {
                return null;
            }
        }

        String code = java.util.UUID.randomUUID().toString().substring(0, 8);
        pendingResets.put(lower, SecurityUtils.sha256WithSalt(code, "reset"));
        pendingResetExpiry.put(lower, System.currentTimeMillis() + 30 * 60 * 1000);
        System.out.println("[UserService] Reset code generated for " + username + " (30 min)");
        return code;
    }

    public boolean verifyResetCode(String username, String code) {
        String lower = username.toLowerCase();
        Long expiry = pendingResetExpiry.get(lower);
        if (expiry == null || System.currentTimeMillis() > expiry) {
            pendingResets.remove(lower);
            pendingResetExpiry.remove(lower);
            return false;
        }
        String hashed = pendingResets.get(lower);
        if (hashed == null) return false;
        if (SecurityUtils.constantTimeEquals(SecurityUtils.sha256WithSalt(code, "reset"), hashed)) {
            pendingResets.remove(lower);
            pendingResetExpiry.remove(lower);
            return true;
        }
        return false;
    }

    public void changePasswordDirect(String username, String newPassword) {
        User user = findByUsername(username);
        if (user == null) return;
        if (!isPasswordPolicyCompliant(newPassword)) return;
        String bcryptHash = SecurityUtils.bcryptHash(newPassword);
        user.setPasswordHash(bcryptHash);
        user.setSalt("bcrypt");
        saveToDisk();
        System.out.println("[UserService] Password reset (direct) for " + username);
    }



    // ================================================================
    // QUERIES
    // ================================================================

    public User getUserByUsername(String username) {
        return username != null ? users.get(username.toLowerCase()) : null;
    }

    public boolean isValidUsername(String username) {
        return username != null && USERNAME_PATTERN.matcher(username.trim()).matches();
    }

    public boolean isPasswordPolicyCompliant(String password) {
        if (password == null || password.length() < MIN_PASSWORD_LENGTH) return false;
        boolean hasUpper = false;
        boolean hasLower = false;
        boolean hasDigit = false;
        boolean hasSymbol = false;
        for (char ch : password.toCharArray()) {
            if (Character.isUpperCase(ch)) hasUpper = true;
            else if (Character.isLowerCase(ch)) hasLower = true;
            else if (Character.isDigit(ch)) hasDigit = true;
            else if (!Character.isWhitespace(ch)) hasSymbol = true;
        }
        return hasUpper && hasLower && hasDigit && hasSymbol;
    }

    public String getPasswordPolicyDescription() {
        return "Password must be at least " + MIN_PASSWORD_LENGTH
                + " characters and include uppercase, lowercase, number, and symbol";
    }

    public List<User> getAllUsers() { return new ArrayList<>(users.values()); }
    public boolean isAdmin(User user) { return user != null && user.getRSub() == 5; }
    public boolean isOnline(String username) {
        Long last = onlineUsers.get(username);
        return last != null && (System.currentTimeMillis() - last) < ONLINE_TIMEOUT_MS;
    }

    public int getOnlineCount() {
        long now = System.currentTimeMillis();
        return (int) onlineUsers.entrySet().stream().filter(e -> (now - e.getValue()) < ONLINE_TIMEOUT_MS).count();
    }
    public int getActiveSessionCount(String username) {
        long now = System.currentTimeMillis();
        return (int) tokens.entrySet().stream().filter(e -> e.getValue().equalsIgnoreCase(username))
                .filter(e -> {
                    Long created = tokenCreatedAt.get(e.getKey());
                    return created == null || (now - created) <= TOKEN_TTL_MS;
                }).count();
    }

    public int revokeAllSessions(String username) {
        String lower = username.toLowerCase();
        List<String> toRemove = tokens.entrySet().stream().filter(e -> e.getValue().equals(lower)).map(Map.Entry::getKey).collect(java.util.stream.Collectors.toList());
        for (String token : toRemove) {
            tokens.remove(token);
            tokenCreatedAt.remove(token);
        }
        onlineUsers.remove(lower);
        System.out.println("[UserService] Revoked " + toRemove.size() + " sessions for " + username);
        return toRemove.size();
    }

    public boolean deleteUser(String targetUsername) {
        String lower = targetUsername.toLowerCase();
        User removed = users.remove(lower);
        if (removed == null) return false;
        tokens.entrySet().removeIf(e -> e.getValue().equals(lower));
        tokenCreatedAt.entrySet().removeIf(e -> e.getValue().equals(lower));
        onlineUsers.remove(lower);
        saveToDisk();
        System.out.println("[UserService] Deleted user " + targetUsername);
        return true;
    }

    // ================================================================
    // PERSISTENCE
    // ================================================================

    private void saveToDisk() {
        try (PrintWriter writer = new PrintWriter(new FileWriter(USERS_FILE))) {
            for (User u : users.values()) {
                writer.println(String.join("|",
                    u.getUsername(),
                    u.getPasswordHash(),
                    safe(u.getDisplayName()),
                    String.valueOf(u.getRSub()),
                    String.valueOf(u.getTSub()),
                    u.getStatus().name(),
                    u.getId(),
                    safe(u.getEmail()),
                    safe(u.getPhone()),
                    safe(u.getOrganization()),
                    safe(u.getSalt()),
                    String.valueOf(u.isEmailVerified()),
                    String.valueOf(u.isPhoneVerified()),
                    String.valueOf(u.getFailedLoginAttempts()),
                    u.getLockedUntil() != null ? u.getLockedUntil().toString() : "",
                    u.getRegisteredAt() != null ? u.getRegisteredAt().toString() : "",
                    safe(u.getOtpIp())
                ));
            }
        } catch (IOException e) {
            System.err.println("[UserService] Save failed: " + e.getMessage());
        }
    }

    private String safe(String s) { return s != null ? s.replace("|", "") : ""; }
    private boolean loadFromDisk() {
        Path path = Paths.get(USERS_FILE);
        if (!Files.exists(path)) return false;
        try (BufferedReader reader = Files.newBufferedReader(path)) {
            String line;
            int count = 0;
            while ((line = reader.readLine()) != null) {
                line = line.trim();
                if (line.isEmpty()) continue;
                String[] p = line.split("\\|", 17);
                if (p.length < 7) continue;

                User user = new User();
                user.setUsername(p[0]);
                user.setPasswordHash(p[1]);
                user.setDisplayName(p[2]);
                user.setRSub(Integer.parseInt(p[3]));
                user.setTSub(Double.parseDouble(p[4]));
                try { user.setStatus(User.Status.valueOf(p[5])); }
                catch (Exception e) { user.setStatus(User.Status.ACTIVE); }
                user.setId(p[6]);
                if (p.length > 7) user.setEmail(p[7]);
                if (p.length > 8) user.setPhone(p[8]);
                if (p.length > 9) user.setOrganization(p[9]);
                if (p.length > 10) user.setSalt(p[10]);
                if (p.length > 11) user.setEmailVerified(Boolean.parseBoolean(p[11]));
                if (p.length > 12) user.setPhoneVerified(Boolean.parseBoolean(p[12]));
                if (p.length > 13) {
                    try { user.setFailedLoginAttempts(Integer.parseInt(p[13])); }
                    catch (Exception ignored) {}
                }
                if (p.length > 14 && !p[14].isEmpty()) {
                    try { user.setLockedUntil(LocalDateTime.parse(p[14])); }
                    catch (Exception ignored) {}
                }
                if (p.length > 15 && !p[15].isEmpty()) {
                    try { user.setRegisteredAt(LocalDateTime.parse(p[15])); }
                    catch (Exception ignored) {}
                } else {
                    user.setRegisteredAt(LocalDateTime.now());
                }
                if (p.length > 16 && !p[16].isEmpty()) {
                    user.setOtpIp(p[16]);
                }

                users.put(user.getUsername(), user);
                count++;
            }
            return count > 0;
        } catch (Exception e) {
            System.err.println("[UserService] Load failed: " + e.getMessage());
            return false;
        }
    }
}
