package org.example.gateway.controller;

import org.example.gateway.model.User;
import org.example.gateway.service.AuditService;
import org.example.gateway.service.CaptchaService;
import org.example.gateway.service.CsrfTokenService;
import org.example.gateway.service.EmailService;
import org.example.gateway.service.LiveEventService;
import org.example.gateway.service.MessageService;
import org.example.gateway.service.RateLimitService;
import org.example.gateway.service.TotpService;
import org.example.gateway.service.AnomalyDetector;
import org.example.gateway.service.UserService;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

@RestController
@RequestMapping("/api/auth")
public class AuthController {

    private final UserService userService;
    private final AuditService auditService;
    private final MessageService messageService;
    private final CaptchaService captchaService;
    private final RateLimitService rateLimitService;
    private final EmailService emailService;
    private final TotpService totpService;
    private final AnomalyDetector anomalyDetector;
    private final LiveEventService liveEventService;
    private final CsrfTokenService csrfTokenService;
    private final ObjectMapper objectMapper = new ObjectMapper();

    @Value("${app.base-url:http://localhost:5051}")
    private String baseUrl;

    @Value("${app.frontend.login-url:http://localhost:5052/login.html}")
    private String frontendLoginUrl;

    @Value("${captcha.enabled:false}")
    private boolean captchaEnabledFlag;

    @Value("${phone.verification.enabled:false}")
    private boolean phoneVerificationEnabled;

    @Value("${email.verification.enabled:true}")
    private boolean emailVerificationEnabled;

    @Value("${app.registration.admin-approval.required:false}")
    private boolean adminApprovalRequired;

    // Regex for validation
    private static final Pattern EMAIL_PATTERN = Pattern.compile("^[a-zA-Z0-9._%+\\-]+@[a-zA-Z0-9.\\-]+\\.[a-zA-Z]{2,}$");
    private static final Pattern PHONE_PATTERN = Pattern.compile("^\\+?[0-9\\-\\s()]{7,20}$");

    // Rate limit constants
    private static final int REG_LIMIT = 5;
    private static final long REG_WINDOW = 3600_000;
    private static final int LOGIN_CAPTCHA_THRESHOLD = 3;
    private static final long RESEND_COOLDOWN = 60_000;
    private static final int RESET_VERIFY_LIMIT = 5;
    private static final long RESET_VERIFY_WINDOW_MS = 15 * 60_000L;

    public AuthController(UserService userService, AuditService auditService,
                          MessageService messageService, CaptchaService captchaService,
                          RateLimitService rateLimitService, EmailService emailService,
                          TotpService totpService, AnomalyDetector anomalyDetector,
                          LiveEventService liveEventService, CsrfTokenService csrfTokenService) {
        this.userService = userService;
        this.auditService = auditService;
        this.messageService = messageService;
        this.captchaService = captchaService;
        this.rateLimitService = rateLimitService;
        this.emailService = emailService;
        this.totpService = totpService;
        this.anomalyDetector = anomalyDetector;
        this.liveEventService = liveEventService;
        this.csrfTokenService = csrfTokenService;
    }

    // ================================================================
    // SIGNUP
    // ================================================================

    @PostMapping("/signup")
    public ResponseEntity<Map<String, Object>> signup(
            @RequestBody Map<String, String> body,
            HttpServletRequest request) {

        Map<String, Object> result = new LinkedHashMap<>();
        String clientIp = extractClientIp(request);

        if (!rateLimitService.isAllowed("reg:" + clientIp, REG_LIMIT, REG_WINDOW)) {
            result.put("error", "Too many registration attempts. Try again later.");
            return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS).body(result);
        }

        if (!captchaService.verify(body.get("captchaToken"), body.get("captchaAnswer"), clientIp)) {
            result.put("error", "CAPTCHA verification failed");
            return ResponseEntity.badRequest().body(result);
        }

        String username = body.get("username");
        String password = body.get("password");
        String displayName = body.get("displayName");
        String email = body.get("email");
        String phone = body.get("phone");

        if (displayName == null || displayName.trim().isEmpty()) displayName = username;

        if (username == null || username.trim().isEmpty()) {
            result.put("error", "Username is required");
            return ResponseEntity.badRequest().body(result);
        }
        if (!userService.isValidUsername(username)) {
            result.put("error", "Username must be 3-32 characters (letters, numbers, '.', '_' or '-')");
            return ResponseEntity.badRequest().body(result);
        }
        username = username.trim().toLowerCase();
        if (!userService.isPasswordPolicyCompliant(password)) {
            result.put("error", userService.getPasswordPolicyDescription());
            return ResponseEntity.badRequest().body(result);
        }

        boolean hasEmail = email != null && !email.trim().isEmpty();
        if (!hasEmail) {
            result.put("error", "Email is required");
            return ResponseEntity.badRequest().body(result);
        }
        if (!EMAIL_PATTERN.matcher(email.trim()).matches()) {
            result.put("error", "Invalid email format");
            return ResponseEntity.badRequest().body(result);
        }
        boolean hasPhone = phone != null && !phone.trim().isEmpty();
        if (hasPhone && !PHONE_PATTERN.matcher(phone.trim()).matches()) {
            result.put("error", "Invalid phone number format");
            return ResponseEntity.badRequest().body(result);
        }

        User user = userService.register(username, password, displayName, email, phone);
        if (user == null) {
            result.put("error", "Username '" + username + "' is already taken");
            return ResponseEntity.status(HttpStatus.CONFLICT).body(result);
        }

        result.put("status", "registered");
        result.put("username", user.getUsername());
        result.put("emailVerificationEnabled", emailVerificationEnabled);
        result.put("phoneVerificationEnabled", phoneVerificationEnabled);
        result.put("adminApprovalRequired", adminApprovalRequired);

        if (!emailVerificationEnabled) {
            result.put("requiresVerification", false);
            if (adminApprovalRequired) {
                userService.setUserStatus(user.getUsername(), User.Status.PENDING);
                result.put("requiresApproval", true);
                result.put("message", "Account request submitted. Waiting for administrator approval.");
                System.out.println("[Auth] Email verification disabled — pending admin approval: " + user.getUsername());
            } else {
                userService.setUserStatus(user.getUsername(), User.Status.ACTIVE);
                result.put("requiresApproval", false);
                result.put("message", "Account created successfully. You can log in now.");
                System.out.println("[Auth] Email verification disabled — auto-activated: " + user.getUsername());
            }
        } else {
            result.put("requiresVerification", true);
            result.put("requiresApproval", adminApprovalRequired);
            String token = userService.generateEmailToken(user.getUsername());
            String verifyUrl = baseUrl + "/api/auth/verify-email?username="
                    + user.getUsername() + "&token=" + token;
            boolean sent = emailService.sendVerificationEmail(email.trim(), displayName, verifyUrl);
            result.put("emailSent", sent);
            result.put("message", sent
                    ? "Verification link sent to " + maskEmail(email)
                    : "Verification email could not be sent. Check gateway console for the link.");
        }

        if (hasPhone && phoneVerificationEnabled) {
            String otp = userService.generateOtp(user.getUsername(), clientIp);
            result.put("otpSent", otp != null && !otp.isEmpty());
            result.put("phoneMessage", "OTP sent to " + maskPhone(phone));
        }

        liveEventService.publishUserChanged("USER_REGISTERED", userService.getUserByUsername(user.getUsername()));
        return ResponseEntity.status(HttpStatus.CREATED).body(result);
    }

    // ================================================================
    // VERIFICATION ENDPOINTS
    // ================================================================

    @GetMapping("/verify-email")
    public ResponseEntity<String> verifyEmail(
            @RequestParam String username,
            @RequestParam String token) {

        boolean ok = userService.verifyEmailToken(username, token);
        if (ok) {
            User verified = userService.getUserByUsername(username);
            liveEventService.publishUserChanged("USER_STATUS_CHANGED", verified);
            String nextStep = verified != null && verified.getStatus() == User.Status.PENDING
                    ? "Your email has been verified. Wait for an administrator to approve your account."
                    : "Your email has been verified. You can now <a href='" + frontendLoginUrl + "'>login</a>.";
            return ResponseEntity.ok("<html><body style='font-family:sans-serif;text-align:center;padding:40px'>"
                + "<h2 style='color:#34d399'>Email Verified!</h2>"
                + "<p>" + nextStep + "</p>"
                + "</body></html>");
        } else {
            return ResponseEntity.badRequest().body(
                "<html><body style='font-family:sans-serif;text-align:center;padding:40px'>"
                + "<h2 style='color:#f87171'>Verification Failed</h2>"
                + "<p>Token is invalid or expired. Please request a new verification link.</p>"
                + "</body></html>");
        }
    }

    // Phone OTP verification
    @PostMapping("/verify-phone")
    public ResponseEntity<Map<String, Object>> verifyPhone(
            @RequestBody Map<String, String> body,
            HttpServletRequest request) {

        String username = body.get("username");
        String otp = body.get("otp");
        Map<String, Object> result = new LinkedHashMap<>();

        if (!phoneVerificationEnabled) {
            result.put("error", "Phone verification is currently disabled");
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).body(result);
        }

        if (username == null || otp == null) {
            result.put("error", "Username and OTP are required");
            return ResponseEntity.badRequest().body(result);
        }

        if (!rateLimitService.isAllowed("otp:" + username, 5, 300_000)) {
            result.put("error", "Too many verification attempts. Try again later.");
            return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS).body(result);
        }

        String clientIp = extractClientIp(request);
        String status = userService.verifyOtp(username, otp, clientIp);

        switch (status) {
            case "ok":
                liveEventService.publishUserChanged("USER_STATUS_CHANGED", userService.getUserByUsername(username));
                result.put("status", "verified");
                result.put("message", "Phone verified (optional). Email verification is still required for login.");
                return ResponseEntity.ok(result);
            case "expired":
                result.put("error", "OTP expired. Please request a new one.");
                return ResponseEntity.badRequest().body(result);
            case "locked":
                result.put("error", "Too many wrong attempts. Request a new OTP.");
                return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS).body(result);
            case "ip_mismatch":
                result.put("error", "OTP must be verified from the same device/network that requested it.");
                return ResponseEntity.status(HttpStatus.FORBIDDEN).body(result);
            default:
                result.put("error", "Invalid OTP");
                return ResponseEntity.badRequest().body(result);
        }
    }

    @PostMapping("/resend-verification")
    public ResponseEntity<Map<String, Object>> resendVerification(
            @RequestBody Map<String, String> body,
            HttpServletRequest request) {

        String username = body.get("username");
        String type = body.get("type");
        Map<String, Object> result = new LinkedHashMap<>();

        if (username == null || type == null) {
            result.put("error", "Username and type required");
            return ResponseEntity.badRequest().body(result);
        }

        User user = userService.getUserByUsername(username);
        if (user == null) {
            result.put("error", "Account not found");
            return ResponseEntity.badRequest().body(result);
        }

        if ("email".equals(type)) {
            if (user.getEmail() == null || user.getEmail().trim().isEmpty()) {
                result.put("error", "No email is set for this account");
                return ResponseEntity.badRequest().body(result);
            }

            String cooldownKey = "resend:" + username + ":email";
            long remaining = rateLimitService.getCooldownRemaining(cooldownKey, RESEND_COOLDOWN);
            if (remaining > 0) {
                result.put("error", "Please wait " + remaining + " seconds before resending");
                return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS).body(result);
            }
            rateLimitService.setCooldown(cooldownKey);

            String token = userService.generateEmailToken(username);
            String verifyUrl = baseUrl + "/api/auth/verify-email?username=" + username + "&token=" + token;
            boolean sent = emailService.sendVerificationEmail(
                    user.getEmail(), user.getDisplayName(), verifyUrl);
            result.put("status", "sent");
            result.put("message", sent ? "New verification link sent" : "Email failed — check console");
            return ResponseEntity.ok(result);
        } else if ("phone".equals(type)) {
            if (!phoneVerificationEnabled) {
                result.put("error", "Phone verification is currently disabled");
                return ResponseEntity.badRequest().body(result);
            }
            if (user.getPhone() == null || user.getPhone().trim().isEmpty()) {
                result.put("error", "No phone is set for this account");
                return ResponseEntity.badRequest().body(result);
            }

            String cooldownKey = "resend:" + username + ":phone";
            long remaining = rateLimitService.getCooldownRemaining(cooldownKey, RESEND_COOLDOWN);
            if (remaining > 0) {
                result.put("error", "Please wait " + remaining + " seconds before resending");
                return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS).body(result);
            }
            rateLimitService.setCooldown(cooldownKey);

            String clientIp = extractClientIp(request);
            String otp = userService.generateOtp(username, clientIp);
            result.put("status", "sent");
            result.put("otpSent", otp != null && !otp.isEmpty());
            result.put("message", "New OTP sent");
            return ResponseEntity.ok(result);
        }

        result.put("error", "Type must be 'email' or 'phone'");
        return ResponseEntity.badRequest().body(result);
    }

    // ================================================================
    // LOGIN
    // ================================================================

    @PostMapping("/login")
    public ResponseEntity<Map<String, Object>> login(
            @RequestBody Map<String, String> body,
            HttpServletRequest request,
            HttpServletResponse response) {

        String username = body.get("username");
        String password = body.get("password");
        String totpCode = body.get("totpCode");
        String clientIp = extractClientIp(request);
        Map<String, Object> result = new LinkedHashMap<>();

        if (captchaEnabledFlag) {
            if (!captchaService.verify(body.get("captchaToken"), body.get("captchaAnswer"), clientIp)) {
                result.put("error", "CAPTCHA verification required");
                result.put("captchaRequired", true);
                return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(result);
            }
        } else if (username != null) {
            int failedCount = userService.getFailedLoginCount(username);
            if (failedCount >= LOGIN_CAPTCHA_THRESHOLD) {
                if (!captchaService.verify(body.get("captchaToken"), body.get("captchaAnswer"), clientIp)) {
                    result.put("error", "CAPTCHA verification required");
                    result.put("captchaRequired", true);
                    return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(result);
                }
            }
        }

        String loginError = userService.getLoginError(username, password);
        if (loginError != null) {
            result.put("error", loginError);
            if (username != null) {
                int failed = userService.getFailedLoginCount(username);
                if (failed >= LOGIN_CAPTCHA_THRESHOLD) {
                    result.put("captchaRequired", true);
                }
            }
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(result);
        }

        if (totpService.isEnabled(username)) {
            if (totpCode == null || totpCode.isEmpty()) {
                result.put("requires2FA", true);
                result.put("message", "Enter your authenticator code");
                return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(result);
            }
            if (!totpService.verify(username, totpCode)) {
                result.put("error", "Invalid authenticator code");
                result.put("requires2FA", true);
                return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(result);
            }
        }

        String token = userService.login(username, password);
        if (token == null) {
            result.put("error", "Login failed");
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(result);
        }

        User user = userService.getUserByUsername(username);
        result.put("status", "authenticated");
        result.put("token", token);
        result.put("user", user.toPublicMap());
        String csrfToken = csrfTokenService.issueToken(token);
        result.put("csrfToken", csrfToken);
        result.put("csrfHeader", CsrfTokenService.HEADER_NAME);
        if (userService.isAdmin(user) && !totpService.isEnabled(username)) {
            result.put("warning2FA", "Two-factor authentication is recommended for admin accounts. "
                    + "Set it up in your profile.");
        }

        addSessionCookies(response, request, token, csrfToken);

        return ResponseEntity.ok(result);
    }

    // ================================================================
    // TOTP 2FA ENDPOINTS
    // ================================================================

    @PostMapping("/2fa/setup")
    public ResponseEntity<Map<String, Object>> setup2FA(
            @RequestHeader(value = "Authorization", required = false) String authHeader) {
        User user = userService.getUserByToken(authHeader);
        if (user == null) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                    .body(Map.of("error", "Not authenticated"));
        }

        Map<String, Object> result = new LinkedHashMap<>();
        if (totpService.isEnabled(user.getUsername())) {
            result.put("error", "2FA is already enabled. Disable it first to reconfigure.");
            return ResponseEntity.badRequest().body(result);
        }

        String secret = totpService.generateSecret(user.getUsername());
        String uri = totpService.getProvisioningUri(user.getUsername(), secret);
        result.put("status", "setup_pending");
        result.put("secret", secret);
        result.put("provisioningUri", uri);
        result.put("message", "Scan the QR code (or enter the secret manually) in your " + "authenticator app, then confirm with a 6-digit code.");
        return ResponseEntity.ok(result);
    }

    @PostMapping("/2fa/confirm")
    public ResponseEntity<Map<String, Object>> confirm2FA(
            @RequestBody Map<String, String> body,
            @RequestHeader(value = "Authorization", required = false) String authHeader) {
        User user = userService.getUserByToken(authHeader);
        if (user == null) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                    .body(Map.of("error", "Not authenticated"));
        }

        String code = body.get("code");
        Map<String, Object> result = new LinkedHashMap<>();
        if (code == null || code.isEmpty()) {
            result.put("error", "Authenticator code is required");
            return ResponseEntity.badRequest().body(result);
        }

        if (totpService.confirmSetup(user.getUsername(), code)) {
            result.put("status", "2fa_enabled");
            result.put("message", "Two-factor authentication is now active.");
            return ResponseEntity.ok(result);
        } else {
            result.put("error", "Invalid code. Make sure your authenticator app " + "is synced and try again.");
            return ResponseEntity.badRequest().body(result);
        }
    }

    @PostMapping("/2fa/disable")
    public ResponseEntity<Map<String, Object>> disable2FA(
            @RequestBody Map<String, String> body,
            @RequestHeader(value = "Authorization", required = false) String authHeader) {

        User user = userService.getUserByToken(authHeader);
        if (user == null) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(Map.of("error", "Not authenticated"));
        }

        String code = body.get("code");
        String targetUser = body.get("username"); // admin override
        Map<String, Object> result = new LinkedHashMap<>();
        // disable 2fa (admin)
        if (targetUser != null && !targetUser.equals(user.getUsername())) {
            if (!userService.isAdmin(user)) {
                result.put("error", "Admin access required");
                return ResponseEntity.status(HttpStatus.FORBIDDEN).body(result);
            }
            totpService.disable(targetUser);
            result.put("status", "2fa_disabled");
            result.put("message", "2FA disabled for " + targetUser);
            return ResponseEntity.ok(result);
        }

        if (code == null || !totpService.verify(user.getUsername(), code)) {
            result.put("error", "Current authenticator code required to disable 2FA");
            return ResponseEntity.badRequest().body(result);
        }

        totpService.disable(user.getUsername());
        result.put("status", "2fa_disabled");
        result.put("message", "Two-factor authentication has been disabled.");
        return ResponseEntity.ok(result);
    }

    @GetMapping("/2fa/status")
    public ResponseEntity<Map<String, Object>> status2FA(
            @RequestHeader(value = "Authorization", required = false) String authHeader) {

        User user = userService.getUserByToken(authHeader);
        if (user == null) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                    .body(Map.of("error", "Not authenticated"));
        }

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("enabled", totpService.isEnabled(user.getUsername()));
        result.put("pending", totpService.isPending(user.getUsername()));
        return ResponseEntity.ok(result);
    }

    // ================================================================
    // PASSWORD CHANGE
    // ================================================================

    @PostMapping("/change-password")
    public ResponseEntity<Map<String, Object>> changePassword(
            @RequestBody Map<String, String> body,
            @RequestHeader(value = "Authorization", required = false) String authHeader) {
        User user = userService.getUserByToken(authHeader);
        if (user == null) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(Map.of("error", "Not authenticated"));
        }

        String currentPassword = body.get("currentPassword");
        String newPassword = body.get("newPassword");
        Map<String, Object> result = new LinkedHashMap<>();

        if (currentPassword == null || newPassword == null) {
            result.put("error", "Both current and new password are required");
            return ResponseEntity.badRequest().body(result);
        }

        if (!userService.isPasswordPolicyCompliant(newPassword)) {
            result.put("error", userService.getPasswordPolicyDescription());
            return ResponseEntity.badRequest().body(result);
        }

        if (userService.changePassword(user.getUsername(), currentPassword, newPassword)) {
            result.put("status", "password_changed");
            result.put("message", "Password updated successfully (BCrypt).");
            return ResponseEntity.ok(result);
        } else {
            result.put("error", "Current password is incorrect or password policy not met");
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(result);
        }
    }

    @PostMapping("/admin/reset-password")
    public ResponseEntity<Map<String, Object>> adminResetPassword(
            @RequestBody Map<String, String> body,
            @RequestHeader(value = "Authorization", required = false) String authHeader) {

        User admin = userService.getUserByToken(authHeader);
        if (admin == null || !userService.isAdmin(admin)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN)
                    .body(Map.of("error", "Admin access required"));
        }

        String targetUsername = body.get("username");
        String newPassword = body.get("newPassword");
        Map<String, Object> result = new LinkedHashMap<>();

        if (targetUsername == null || newPassword == null) {
            result.put("error", "Username and new password are required");
            return ResponseEntity.badRequest().body(result);
        }
        if (!userService.isPasswordPolicyCompliant(newPassword)) {
            result.put("error", userService.getPasswordPolicyDescription());
            return ResponseEntity.badRequest().body(result);
        }

        if (userService.adminResetPassword(targetUsername, newPassword)) {
            result.put("status", "password_reset");
            result.put("message", "Password reset for " + targetUsername);
            return ResponseEntity.ok(result);
        } else {
            result.put("error", "User not found or invalid password");
            return ResponseEntity.badRequest().body(result);
        }
    }
    
    @PostMapping("/reset-with-code")
    public ResponseEntity<Map<String, Object>> resetWithCode(
        @RequestBody Map<String, String> body,
        HttpServletRequest request) {
        String username = body.get("username");
        String code = body.get("resetCode");
        String newPassword = body.get("newPassword");

        if (username == null || code == null || newPassword == null)
            return ResponseEntity.badRequest().body(Map.of("error", "Username, resetCode, and newPassword required"));
        if (!userService.isValidUsername(username))
            return ResponseEntity.badRequest().body(Map.of("error", "Invalid username format"));

        String resetKey = "reset-code:" + username.toLowerCase() + ":" + extractClientIp(request);
        if (!rateLimitService.isAllowed(resetKey, RESET_VERIFY_LIMIT, RESET_VERIFY_WINDOW_MS)) {
            return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS)
                    .body(Map.of("error", "Too many reset attempts. Try again later."));
        }

        if (!userService.isPasswordPolicyCompliant(newPassword))
            return ResponseEntity.badRequest().body(Map.of("error", userService.getPasswordPolicyDescription()));

        if (!userService.verifyResetCode(username, code))
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(Map.of("error", "Invalid or expired reset code"));

        userService.changePasswordDirect(username, newPassword);
        return ResponseEntity.ok(Map.of("status", "password_reset", "message", "Password has been reset. You can now log in."));
    }

    // ================================================================
    // ANOMALY ALERTS
    // ================================================================

    @GetMapping("/admin/anomalies")
    public ResponseEntity<?> getAnomalies(
            @RequestParam(value = "all", defaultValue = "false") boolean showAll,
            @RequestHeader(value = "Authorization", required = false) String authHeader) {
        User admin = userService.getUserByToken(authHeader);
        if (admin == null || !userService.isAdmin(admin)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN)
                    .body(Map.of("error", "Admin access required"));
        }

        List<Map<String, Object>> alerts = showAll
                ? anomalyDetector.getAllAlertsWithIndex()
                : anomalyDetector.getUnreviewedAlertsWithIndex();
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("alerts", alerts);
        result.put("stats", anomalyDetector.getStats());
        return ResponseEntity.ok(result);
    }

    @PostMapping("/admin/anomalies/unblock/{username}")
    public ResponseEntity<?> unblockUser(
            @PathVariable String username,
            @RequestHeader(value = "Authorization", required = false) String authHeader) {
        User admin = userService.getUserByToken(authHeader);
        if (admin == null || !userService.isAdmin(admin)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN)
                    .body(Map.of("error", "Admin access required"));
        }

        anomalyDetector.unblock(username);
        return ResponseEntity.ok(Map.of("status", "unblocked", "username", username));
    }

    @PostMapping("/admin/anomalies/review-all")
    public ResponseEntity<?> reviewAllAnomalies(
            @RequestHeader(value = "Authorization", required = false) String authHeader) {
        User admin = userService.getUserByToken(authHeader);
        if (admin == null || !userService.isAdmin(admin)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN)
                    .body(Map.of("error", "Admin access required"));
        }
        int count = anomalyDetector.markAllReviewed();
        return ResponseEntity.ok(Map.of("status", "reviewed", "count", count));
    }

    @PostMapping("/admin/anomalies/review/{index}")
    public ResponseEntity<?> reviewAnomaly(
            @PathVariable int index,
            @RequestHeader(value = "Authorization", required = false) String authHeader) {
        User admin = userService.getUserByToken(authHeader);
        if (admin == null || !userService.isAdmin(admin)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN)
                    .body(Map.of("error", "Admin access required"));
        }
        anomalyDetector.markReviewed(index);
        return ResponseEntity.ok(Map.of("status", "reviewed"));
    }

    @DeleteMapping("/admin/anomalies/{index}")
    public ResponseEntity<?> deleteAnomaly(
            @PathVariable int index,
            @RequestHeader(value = "Authorization", required = false) String authHeader) {
        User admin = userService.getUserByToken(authHeader);
        if (admin == null || !userService.isAdmin(admin)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN)
                    .body(Map.of("error", "Admin access required"));
        }
        boolean ok = anomalyDetector.deleteAlert(index);
        if (ok) return ResponseEntity.ok(Map.of("status", "deleted"));
        return ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of("error", "Alert not found"));
    }

    @DeleteMapping("/admin/anomalies")
    public ResponseEntity<?> deleteAllAnomalies(
            @RequestHeader(value = "Authorization", required = false) String authHeader) {
        User admin = userService.getUserByToken(authHeader);
        if (admin == null || !userService.isAdmin(admin)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN)
                    .body(Map.of("error", "Admin access required"));
        }
        int count = anomalyDetector.deleteAllAlerts();
        return ResponseEntity.ok(Map.of("status", "deleted", "count", count));
    }

    // ================================================================
    // PROFILE & LOGOUT
    // ================================================================

    @GetMapping("/me")
    public ResponseEntity<Map<String, Object>> me(
            @RequestHeader(value = "Authorization", required = false) String authHeader) {
        User user = userService.getUserByToken(authHeader);
        if (user == null) return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                .body(Map.of("error", "Not authenticated"));
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("user", user.toPublicMap());
        result.put("isAdmin", userService.isAdmin(user));
        result.put("has2FA", totpService.isEnabled(user.getUsername()));
        return ResponseEntity.ok(result);
    }

    @GetMapping("/admin-status")
    public ResponseEntity<?> adminStatus(@RequestHeader(value = "Authorization", required = false) String authHeader) {
        User user = userService.getUserByToken(authHeader);
        if (user == null) {
        return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(Map.of("error", "Authentication required"));
        }
        return ResponseEntity.ok(Map.of("adminOnline", userService.isOnline("admin")));
    }

    // ================================================================
    // CAPTCHA CHALLENGE — Math CAPTCHA (self-hosted, no external deps)
    // ================================================================
    @GetMapping("/captcha-challenge")
    public ResponseEntity<Map<String, Object>> captchaChallenge() {
        return ResponseEntity.ok(captchaService.getChallenge());
    }

    @GetMapping("/captcha-config")
    public ResponseEntity<Map<String, Object>> captchaConfig() {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("enabled", captchaEnabledFlag);
        result.put("type", captchaService.getPublicType());
        result.put("sitekey", captchaService.getPublicSitekey());
        result.put("mathFallbackEnabled", captchaService.isMathFallbackAvailable());
        result.put("phoneVerificationEnabled", phoneVerificationEnabled);
        result.put("emailVerificationEnabled", emailVerificationEnabled);
        return ResponseEntity.ok(result);
    }

    @GetMapping("/csrf")
    public ResponseEntity<Map<String, Object>> csrf(
            @RequestHeader(value = "Authorization", required = false) String authHeader,
            HttpServletRequest request,
            HttpServletResponse response) {
        User user = userService.getUserByToken(authHeader);
        String authToken = rawBearerToken(authHeader);
        if (user == null || authToken == null) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                    .body(Map.of("error", "Not authenticated"));
        }
        String csrfToken = csrfTokenService.issueToken(authToken);
        addCsrfCookie(response, request, csrfToken, 60 * 60 * 8);
        return ResponseEntity.ok(Map.of(
                "csrfToken", csrfToken,
                "csrfHeader", CsrfTokenService.HEADER_NAME));
    }

    @PostMapping("/logout")
    public ResponseEntity<Map<String, Object>> logout(
            @RequestHeader(value = "Authorization", required = false) String authHeader,
            HttpServletRequest request,
            HttpServletResponse response) {
        String token = rawBearerToken(authHeader);
        if (token != null) {
            userService.logout(token);
        }
        clearSessionCookies(response, request);
        return ResponseEntity.ok(Map.of("status", "logged_out"));
    }

    @PostMapping("/profile")
    public ResponseEntity<Map<String, Object>> updateProfile(
            @RequestBody Map<String, String> body,
            @RequestHeader(value = "Authorization", required = false) String authHeader) {
        User user = userService.getUserByToken(authHeader);
        if (user == null) return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                .body(Map.of("error", "Not authenticated"));
        userService.updateProfile(user.getUsername(),
                body.get("displayName"), null, null, body.get("organization"));
        User updated = userService.getUserByUsername(user.getUsername());
        return ResponseEntity.ok(Map.of("status", "profile_updated", "user", updated.toPublicMap()));
    }

    @GetMapping("/sessions")
    public ResponseEntity<Map<String, Object>> getSessions(
            @RequestHeader(value = "Authorization", required = false) String authHeader) {
        User user = userService.getUserByToken(authHeader);
        if (user == null) return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                .body(Map.of("error", "Not authenticated"));

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("username", user.getUsername());
        result.put("activeSessions", userService.getActiveSessionCount(user.getUsername()));
        return ResponseEntity.ok(result);
    }

    @PostMapping("/sessions/revoke-all")
    public ResponseEntity<Map<String, Object>> revokeAllSessions(
            @RequestHeader(value = "Authorization", required = false) String authHeader) {
        User user = userService.getUserByToken(authHeader);
        if (user == null) return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                .body(Map.of("error", "Not authenticated"));
        int revoked = userService.revokeAllSessions(user.getUsername());
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("status", "all_sessions_revoked");
        result.put("revokedCount", revoked);
        result.put("message", "All " + revoked + " sessions revoked. You have been logged out everywhere.");
        return ResponseEntity.ok(result);
    }

    // ================================================================
    // ABOUT ME
    // ================================================================

    @GetMapping("/about/{username}")
    public ResponseEntity<?> getAbout(@PathVariable String username,
            @RequestHeader(value = "Authorization", required = false) String authHeader) {
        User user = userService.getUserByToken(authHeader);
        if (user == null) return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                .body(Map.of("error", "Not authenticated"));
        String normalized = normalizeUsername(username);
        if (normalized == null) return ResponseEntity.badRequest().body(Map.of("error", "Invalid username format"));
        if (!user.getUsername().equalsIgnoreCase(normalized) && !userService.isAdmin(user)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).body(Map.of("error", "Access denied"));
        }
        try {
            Path path = resolveAboutPath(normalized);
            if (!Files.exists(path)) return ResponseEntity.ok(Map.of());
            String json = Files.readString(path, StandardCharsets.UTF_8);
            Map<String, Object> parsed = objectMapper.readValue(json, new com.fasterxml.jackson.core.type.TypeReference<Map<String, Object>>() {});
            Map<String, Object> result = new LinkedHashMap<>();
            for (String key : new String[]{"fullName", "age", "location", "occupation", "interests", "bio"}) {
                Object value = parsed.getOrDefault(key, "");
                result.put(key, value == null ? "" : String.valueOf(value));
            }
            return ResponseEntity.ok(result);
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(Map.of("error", "Failed to read about info"));
        }
    }

    @PostMapping("/about")
    public ResponseEntity<?> saveAbout(@RequestBody Map<String, String> body,
            @RequestHeader(value = "Authorization", required = false) String authHeader) {
        User user = userService.getUserByToken(authHeader);
        if (user == null) return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                .body(Map.of("error", "Not authenticated"));
        try {
            Path path = resolveAboutPath(user.getUsername());
            Files.createDirectories(path.getParent());
            Map<String, String> toSave = new LinkedHashMap<>();
            String[] keys = {"fullName", "age", "location", "occupation", "interests", "bio"};
            for (String key : keys) {
                String raw = body.getOrDefault(key, "");
                String sanitized = raw.replace("\r", " ").replace("\n", " ").trim();
                toSave.put(key, sanitized);
            }
            Files.writeString(path, objectMapper.writeValueAsString(toSave), StandardCharsets.UTF_8);
            return ResponseEntity.ok(Map.of("status", "saved"));
        } catch (Exception e) {
            return ResponseEntity.badRequest().body(Map.of("error", "Save failed: " + e.getMessage()));
        }
    }

    // ================================================================
    // MESSAGING
    // ================================================================

    @PostMapping("/messages/send")
    public ResponseEntity<Map<String, Object>> sendMessage(
            @RequestBody Map<String, String> body,
            @RequestHeader(value = "Authorization", required = false) String authHeader) {
        User user = userService.getUserByToken(authHeader);
        if (user == null) return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                .body(Map.of("error", "Not authenticated"));
        String to = body.get("to");
        String content = body.get("message");
        if (to == null || to.trim().isEmpty()) return ResponseEntity.badRequest()
                .body(Map.of("error", "Recipient required"));
        if (content == null || content.trim().isEmpty()) return ResponseEntity.badRequest()
                .body(Map.of("error", "Message cannot be empty"));
        if (content.length() > 10000) return ResponseEntity.badRequest()
                .body(Map.of("error", "Message too long (max 10000 characters)"));
        String sender = user.getUsername();
        if (userService.isAdmin(user) && !"admin".equalsIgnoreCase(to.trim())) {
            sender = "admin".equals(user.getUsername()) ? "admin" : user.getUsername() + " admin";
        }
        MessageService.Message msg = messageService.send(sender, to.trim(), content.trim());
        if (msg == null) return ResponseEntity.badRequest().body(Map.of("error", "Failed to send"));
        return ResponseEntity.ok(Map.of("status", "sent", "message", msg.toMap()));
    }

    @GetMapping("/messages/conversations")
    public ResponseEntity<?> getConversations(
            @RequestHeader(value = "Authorization", required = false) String authHeader) {
        User user = userService.getUserByToken(authHeader);
        if (user == null) return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                .body(Map.of("error", "Not authenticated"));
        List<Map<String, Object>> convs = userService.isAdmin(user)
                ? messageService.getAdminConversationList(user.getUsername())
                : messageService.getConversationList(user.getUsername());
        return ResponseEntity.ok(Map.of("conversations", convs,
                "totalUnread", messageService.countTotalUnread(user.getUsername())));
    }

    @GetMapping("/messages/with/{partner}")
    public ResponseEntity<?> getConversation(
            @PathVariable String partner,
            @RequestHeader(value = "Authorization", required = false) String authHeader) {
        User user = userService.getUserByToken(authHeader);
        if (user == null) return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                .body(Map.of("error", "Not authenticated"));
        messageService.markRead(user.getUsername(), partner);
        if (userService.isAdmin(user)) messageService.markRead("admin", partner);
        List<Map<String, Object>> msgs = (userService.isAdmin(user)
                ? messageService.getAdminConversation(user.getUsername(), partner)
                : messageService.getConversation(user.getUsername(), partner))
                .stream().map(MessageService.Message::toMap).collect(Collectors.toList());
        Collections.reverse(msgs);
        return ResponseEntity.ok(Map.of("partner", partner, "messages", msgs));
    }

    @GetMapping("/messages/unread")
    public ResponseEntity<?> getUnreadCount(
            @RequestHeader(value = "Authorization", required = false) String authHeader) {
        User user = userService.getUserByToken(authHeader);
        if (user == null) return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                .body(Map.of("error", "Not authenticated"));
        return ResponseEntity.ok(Map.of("unread", messageService.countTotalUnread(user.getUsername())));
    }

    @PostMapping("/messages/read-all")
    public ResponseEntity<?> markAllRead(
            @RequestHeader(value = "Authorization", required = false) String authHeader) {
        User user = userService.getUserByToken(authHeader);
        if (user == null) return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                .body(Map.of("error", "Not authenticated"));
        messageService.markAllRead(user.getUsername());
        if (userService.isAdmin(user)) messageService.markAllRead("admin");
        return ResponseEntity.ok(Map.of("status", "all_read"));
    }

    @GetMapping("/admin/messages")
    public ResponseEntity<?> adminGetMessages(
            @RequestHeader(value = "Authorization", required = false) String authHeader) {
        User admin = userService.getUserByToken(authHeader);
        if (admin == null || !userService.isAdmin(admin)) return ResponseEntity.status(HttpStatus.FORBIDDEN)
                .body(Map.of("error", "Admin access required"));
        List<Map<String, Object>> msgs = messageService.getAll().stream()
                .map(MessageService.Message::toMap).collect(Collectors.toList());
        return ResponseEntity.ok(Map.of("totalMessages", msgs.size(), "messages", msgs));
    }

    // ================================================================
    // ADMIN: USER MANAGEMENT
    // ================================================================

    @GetMapping("/admin/users")
    public ResponseEntity<?> listUsers(
            @RequestHeader(value = "Authorization", required = false) String authHeader) {
        User admin = userService.getUserByToken(authHeader);
        if (admin == null || !userService.isAdmin(admin)) return ResponseEntity.status(HttpStatus.FORBIDDEN)
                .body(Map.of("error", "Admin access required"));
        List<Map<String, Object>> users = userService.getAllUsers().stream().map(u -> {
            Map<String, Object> m = u.toPublicMap();
            m.put("online", userService.isOnline(u.getUsername()));
            m.put("has2FA", totpService.isEnabled(u.getUsername()));
            return m;
        }).collect(Collectors.toList());
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("totalUsers", users.size());
        result.put("onlineCount", userService.getOnlineCount());
        result.put("users", users);
        return ResponseEntity.ok(result);
    }

    /**
     * Step-up MFA freshness gate. Admin actions that promote roles or change
     * trust scores require a recently-authenticated session — within 5 minutes
     * of the last successful login. Forces the admin to re-auth before
     * mutating powerful state, mitigating session-hijack-then-promote.
     */
    private static final long STEP_UP_FRESHNESS_MS = 5L * 60_000L;
    private boolean requireStepUpFresh(User admin) {
        if (admin == null || admin.getLastLoginAt() == null) return false;
        long ageMs = java.time.Duration.between(admin.getLastLoginAt(),
                java.time.LocalDateTime.now()).toMillis();
        return ageMs <= STEP_UP_FRESHNESS_MS;
    }

    @PostMapping("/admin/users/{username}/role")
    public ResponseEntity<Map<String, Object>> setRole(
            @PathVariable String username, @RequestBody Map<String, Object> body,
            @RequestHeader(value = "Authorization", required = false) String authHeader) {
        if (!userService.isValidUsername(username)) {
            return ResponseEntity.badRequest().body(Map.of("error", "Invalid username format"));
        }
        User admin = userService.getUserByToken(authHeader);
        if (admin == null || !userService.isAdmin(admin)) return ResponseEntity.status(HttpStatus.FORBIDDEN)
                .body(Map.of("error", "Admin access required"));
        if (!requireStepUpFresh(admin)) return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                .body(Map.of("error", "Step-up authentication required",
                        "reason", "Re-login within 5 minutes before changing roles",
                        "stepUp", true));
        Map<String, Object> result = new LinkedHashMap<>();
        User target = userService.getUserByUsername(username);
        if (target != null && target.getRSub() == 5 && !"admin".equals(admin.getUsername())) {
            result.put("error", "Only the system administrator can modify other admin accounts");
            return ResponseEntity.status(HttpStatus.FORBIDDEN).body(result);
        }
        int newRole;
        try { newRole = ((Number) body.get("rSub")).intValue(); }
        catch (Exception e) { return ResponseEntity.badRequest().body(Map.of("error", "Invalid rSub")); }
        if (!userService.setUserRole(username, newRole)) return ResponseEntity.badRequest()
                .body(Map.of("error", "User not found or invalid role"));
        User updated = userService.getUserByUsername(username);
        liveEventService.publishUserChanged("USER_ROLE_CHANGED", updated);
        return ResponseEntity.ok(Map.of("status", "role_updated", "user", updated.toPublicMap()));
    }

    @PostMapping("/admin/users/{username}/trust")
    public ResponseEntity<Map<String, Object>> setTrust(
            @PathVariable String username, @RequestBody Map<String, Object> body,
            @RequestHeader(value = "Authorization", required = false) String authHeader) {
        if (!userService.isValidUsername(username)) {
            return ResponseEntity.badRequest().body(Map.of("error", "Invalid username format"));
        }
        User admin = userService.getUserByToken(authHeader);
        if (admin == null || !userService.isAdmin(admin)) return ResponseEntity.status(HttpStatus.FORBIDDEN)
                .body(Map.of("error", "Admin access required"));
        if (!requireStepUpFresh(admin)) return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                .body(Map.of("error", "Step-up authentication required",
                        "reason", "Re-login within 5 minutes before changing trust",
                        "stepUp", true));
        double newTrust;
        try { newTrust = ((Number) body.get("tSub")).doubleValue(); }
        catch (Exception e) { return ResponseEntity.badRequest().body(Map.of("error", "Invalid tSub")); }
        userService.setUserTrust(username, newTrust);
        liveEventService.publishUserChanged("USER_TRUST_CHANGED", userService.getUserByUsername(username));
        return ResponseEntity.ok(Map.of("status", "trust_updated"));
    }

    @PostMapping("/admin/users/{username}/status")
    public ResponseEntity<Map<String, Object>> setStatus(
            @PathVariable String username, @RequestBody Map<String, Object> body,
            @RequestHeader(value = "Authorization", required = false) String authHeader) {
        if (!userService.isValidUsername(username)) {
            return ResponseEntity.badRequest().body(Map.of("error", "Invalid username format"));
        }
        User admin = userService.getUserByToken(authHeader);
        if (admin == null || !userService.isAdmin(admin)) return ResponseEntity.status(HttpStatus.FORBIDDEN)
                .body(Map.of("error", "Admin access required"));
        try {
            User.Status status = User.Status.valueOf(((String) body.get("status")).toUpperCase());
            userService.setUserStatus(username, status);
            User updated = userService.getUserByUsername(username);
            liveEventService.publishUserChanged("USER_STATUS_CHANGED", updated);
            return ResponseEntity.ok(Map.of("status", "status_updated", "user", updated.toPublicMap()));
        } catch (Exception e) { return ResponseEntity.badRequest().body(Map.of("error", "Invalid status")); }
    }

    @PostMapping("/admin/users/{username}/delete")
    public ResponseEntity<Map<String, Object>> deleteUser(
            @PathVariable String username,
            @RequestHeader(value = "Authorization", required = false) String authHeader) {
        if (!userService.isValidUsername(username)) {
            return ResponseEntity.badRequest().body(Map.of("error", "Invalid username format"));
        }
        User admin = userService.getUserByToken(authHeader);
        if (admin == null || !userService.isAdmin(admin)) return ResponseEntity.status(HttpStatus.FORBIDDEN)
                .body(Map.of("error", "Admin access required"));
        User target = userService.getUserByUsername(username);
        if (target != null && target.getRSub() == 5 && !"admin".equals(admin.getUsername())) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN)
                    .body(Map.of("error", "Only the system administrator can delete other admin accounts"));
        }
        if (!userService.deleteUser(username)) {
            return ResponseEntity.badRequest().body(Map.of("error", "User not found"));
        }
        liveEventService.publishUserDeleted(username);
        return ResponseEntity.ok(Map.of("status", "deleted"));
    }

    @PostMapping("/admin/users/{username}/request-reset")
    public ResponseEntity<Map<String, Object>> requestPasswordReset(
            @PathVariable String username,
            @RequestHeader(value = "Authorization", required = false) String authHeader) {
        User admin = userService.getUserByToken(authHeader);
        if (admin == null || admin.getRSub() < 5)
            return ResponseEntity.status(HttpStatus.FORBIDDEN).body(Map.of("error", "Admin access required"));
        if (!userService.isValidUsername(username))
            return ResponseEntity.badRequest().body(Map.of("error", "Invalid username format"));
        User target = userService.findByUsername(username);
        if (target == null)
            return ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of("error", "User not found"));
        String code = userService.setPendingReset(username);
        if (code == null) {
            return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS).body(Map.of("error", "Reset already pending for this user. Wait 2 minutes."));
        }

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("status", "reset_requested");
        result.put("resetCode", code);
        result.put("message", "Give this code to " + username + ". They enter it on the login page to set a new password. Expires in 30 minutes.");
        return ResponseEntity.ok(result);
    }

    // ================================================================
    // AUDIT LOG
    // ================================================================

    @GetMapping("/audit")
    public ResponseEntity<?> myAuditLog(
            @RequestParam(value = "limit", defaultValue = "50") int limit,
            @RequestHeader(value = "Authorization", required = false) String authHeader) {
        User user = userService.getUserByToken(authHeader);
        if (user == null) return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                .body(Map.of("error", "Not authenticated"));
        List<Map<String, Object>> entries = auditService.getByUser(user.getUsername()).stream()
                .limit(limit).map(AuditService.AuditEntry::toMap).collect(Collectors.toList());
        return ResponseEntity.ok(Map.of("username", user.getUsername(),
                "totalEntries", entries.size(), "entries", entries));
    }

    @GetMapping("/admin/audit")
    public ResponseEntity<?> adminAuditLog(
            @RequestParam(value = "limit", defaultValue = "100") int limit,
            @RequestHeader(value = "Authorization", required = false) String authHeader) {
        User admin = userService.getUserByToken(authHeader);
        if (admin == null || !userService.isAdmin(admin)) return ResponseEntity.status(HttpStatus.FORBIDDEN)
                .body(Map.of("error", "Admin access required"));
        List<Map<String, Object>> entries = auditService.getRecent(limit).stream()
                .map(AuditService.AuditEntry::toMap).collect(Collectors.toList());
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("totalEntries", auditService.getTotalCount());
        result.put("tamperedEntries", auditService.getTamperedCount());
        result.put("legacyEntries", auditService.getLegacyCount());
        result.put("showing", entries.size());
        result.put("entries", entries);
        return ResponseEntity.ok(result);
    }

    @GetMapping("/admin/audit/stats")
    public ResponseEntity<?> auditStats(
            @RequestHeader(value = "Authorization", required = false) String authHeader) {
        User admin = userService.getUserByToken(authHeader);
        if (admin == null || !userService.isAdmin(admin)) return ResponseEntity.status(HttpStatus.FORBIDDEN)
                .body(Map.of("error", "Admin access required"));
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("totalEvents", auditService.getTotalCount());
        result.put("tamperedEvents", auditService.getTamperedCount());
        result.put("decisionCounts", auditService.getDecisionCounts());
        result.put("fileAccessCounts", auditService.getFileAccessCounts());
        result.put("filePermitCounts", auditService.getFileAccessCountsByDecision("PERMIT"));
        result.put("filePermitCounts24h", auditService.getFileAccessCountsLastHoursByDecision(24, "PERMIT"));
        result.put("userAccessCounts", auditService.getUserAccessCounts());
        result.put("last24h", auditService.getLastHours(24).stream()
                .map(AuditService.AuditEntry::toMap).collect(Collectors.toList()));
        return ResponseEntity.ok(result);
    }

    // ================================================================
    // HELPERS
    // ================================================================

    private String extractClientIp(HttpServletRequest request) {
        String remoteAddr = normalizeIp(request.getRemoteAddr());
        if (isTrustedProxy(remoteAddr)) {
            String forwarded = firstForwardedIp(request.getHeader("X-Forwarded-For"));
            if (forwarded != null) return forwarded;
            String realIp = normalizeIp(request.getHeader("X-Real-IP"));
            if (realIp != null) return realIp;
        }
        return remoteAddr != null ? remoteAddr : "";
    }

    private String rawBearerToken(String authHeader) {
        if (authHeader == null || authHeader.isBlank()) return null;
        String token = authHeader.startsWith("Bearer ") ? authHeader.substring(7) : authHeader;
        token = token.trim();
        return token.isEmpty() ? null : token;
    }

    private void addSessionCookies(HttpServletResponse response, HttpServletRequest request, String authToken, String csrfToken) {
        int maxAge = 60 * 60 * 8;
        addCookieHeader(response, request, "caac_token", authToken, maxAge, true);
        addCsrfCookie(response, request, csrfToken, maxAge);
    }

    private void addCsrfCookie(HttpServletResponse response, HttpServletRequest request, String csrfToken, int maxAge) {
        addCookieHeader(response, request, CsrfTokenService.COOKIE_NAME, csrfToken, maxAge, false);
    }

    private void clearSessionCookies(HttpServletResponse response, HttpServletRequest request) {
        addCookieHeader(response, request, "caac_token", "", 0, true);
        addCookieHeader(response, request, CsrfTokenService.COOKIE_NAME, "", 0, false);
    }

    private void addCookieHeader(HttpServletResponse response, HttpServletRequest request,
                                 String name, String value, int maxAge, boolean httpOnly) {
        response.addHeader("Set-Cookie",
                name + "=" + value
                        + "; Path=/; Max-Age=" + maxAge
                        + (httpOnly ? "; HttpOnly" : "")
                        + "; SameSite=Strict"
                        + (request.isSecure() ? "; Secure" : ""));
    }

    private String firstForwardedIp(String xForwardedFor) {
        if (xForwardedFor == null || xForwardedFor.isBlank()) return null;
        String[] ips = xForwardedFor.split(",");
        if (ips.length == 0) return null;
        return normalizeIp(ips[0]);
    }

    private String normalizeIp(String ip) {
        if (ip == null) return null;
        String value = ip.trim();
        if (value.isEmpty()) return null;
        if (value.startsWith("[") && value.contains("]")) {
            value = value.substring(1, value.indexOf(']'));
        } else if (value.matches("^\\d+\\.\\d+\\.\\d+\\.\\d+:\\d+$")) {
            value = value.substring(0, value.indexOf(':'));
        }
        return value.isEmpty() ? null : value;
    }

    private boolean isTrustedProxy(String ip) {
        if (ip == null || ip.isBlank()) return false;
        if ("127.0.0.1".equals(ip) || "::1".equals(ip) || "0:0:0:0:0:0:0:1".equals(ip)) return true;
        if (ip.startsWith("10.") || ip.startsWith("192.168.") || ip.startsWith("::ffff:127.") || ip.startsWith("::ffff:10.") || ip.startsWith("::ffff:192.168.")) {
            return true;
        }
        if (ip.startsWith("172.") || ip.startsWith("::ffff:172.")) {
            String normalized = ip.startsWith("::ffff:") ? ip.substring("::ffff:".length()) : ip;
            String[] parts = normalized.split("\\.");
            if (parts.length >= 2) {
                try {
                    int second = Integer.parseInt(parts[1]);
                    return second >= 16 && second <= 31;
                } catch (NumberFormatException ignored) {
                    return false;
                }
            }
        }
        return false;
    }

    private String maskEmail(String e) {
        if (e == null || !e.contains("@")) return "***";
        int at = e.indexOf('@');
        return at <= 1 ? e : e.charAt(0) + "***" + e.substring(at);
    }

    private String maskPhone(String p) {
        if (p == null || p.length() < 6) return "***";
        return p.substring(0, 3) + "***" + p.substring(p.length() - 4);
    }

    private String normalizeUsername(String username) {
        if (username == null) return null;
        String trimmed = username.trim().toLowerCase();
        return userService.isValidUsername(trimmed) ? trimmed : null;
    }

    private Path resolveAboutPath(String username) {
        String normalized = normalizeUsername(username);
        if (normalized == null) throw new IllegalArgumentException("Invalid username");
        Path base = Paths.get("data", "about").toAbsolutePath().normalize();
        Path resolved = base.resolve(normalized + ".json").normalize();
        if (!resolved.startsWith(base)) {
            throw new IllegalArgumentException("Invalid about path");
        }
        return resolved;
    }
}
