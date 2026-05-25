package org.example.gateway.service;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.mail.javamail.MimeMessageHelper;
import org.springframework.stereotype.Service;
import jakarta.mail.internet.MimeMessage;

/**
 * EmailService - Sends verification emails asynchronously via Spring Mail
 * Email is sent in a background thread so HTTP responses return immediately
 */
@Service
public class EmailService {

    private final JavaMailSender mailSender;
    @Value("${mail.from:${spring.mail.username:noreply@caac-system.com}}")
    private String fromAddress;
    public EmailService(JavaMailSender mailSender) {
        this.mailSender = mailSender;
        System.out.println("[EmailService] Initialized with JavaMailSender");
    }

    public boolean sendVerificationEmail(String toEmail, String recipientName, String verifyUrl) {
        System.out.println("[Email] Queuing verification email for " + toEmail);
        System.out.println("[Email] Verify URL: " + verifyUrl);

        new Thread(() -> {
            try {
                MimeMessage message = mailSender.createMimeMessage();
                MimeMessageHelper helper = new MimeMessageHelper(message, true, "UTF-8");
                helper.setFrom(fromAddress, "CAAC System");
                helper.setTo(toEmail);
                helper.setSubject("CAAC System — Verify your email");
                helper.setText(buildVerificationHtml(recipientName, verifyUrl), true);
                mailSender.send(message);
                System.out.println("[Email] Sent successfully to " + toEmail);

            } catch (Exception e) {
                System.err.println("[Email] FAILED to send to " + toEmail + ": " + e.getMessage());
                System.out.println("[Email] User can still verify via console URL above");
            }
        }, "email-" + toEmail).start();

        return true;
    }

    private String buildVerificationHtml(String name, String url) {
        return "<!DOCTYPE html><html><body style='font-family:-apple-system,BlinkMacSystemFont,sans-serif;"
            + "max-width:520px;margin:40px auto;padding:24px;background:#f8f9fa;border-radius:12px'>"
            + "<div style='text-align:center;margin-bottom:24px'>"
            + "<div style='display:inline-block;width:52px;height:52px;border-radius:14px;"
            + "background:#0f172a;color:#5ea4f8;font-family:monospace;font-size:22px;font-weight:bold;"
            + "line-height:52px;text-align:center'>CA</div></div>"
            + "<h2 style='text-align:center;color:#1a1a2e;margin-bottom:8px'>Verify your email</h2>"
            + "<p style='text-align:center;color:#666;font-size:14px;margin-bottom:24px'>"
            + "Hello " + esc(name != null ? name : "there") + ",</p>"
            + "<p style='color:#444;font-size:14px;line-height:1.6'>"
            + "Thank you for registering with the <strong>CAAC System</strong>. "
            + "Click the button below to verify your email address and activate your account:</p>"
            + "<div style='text-align:center;margin:32px 0'>"
            + "<a href='" + url + "' style='display:inline-block;padding:14px 40px;"
            + "background:#5ea4f8;color:white;text-decoration:none;border-radius:8px;"
            + "font-weight:600;font-size:15px'>Verify Email Address</a></div>"
            + "<p style='font-size:12px;color:#888;line-height:1.6'>"
            + "This link expires in <strong>15 minutes</strong>. "
            + "If you didn't create an account, you can safely ignore this email.</p>"
            + "<p style='font-size:11px;color:#aaa;margin-top:8px'>If the button doesn't work, "
            + "copy and paste this URL into your browser:</p>"
            + "<p style='font-size:11px;color:#5ea4f8;word-break:break-all'>" + url + "</p>"
            + "<hr style='border:none;border-top:1px solid #e5e7eb;margin:24px 0'>"
            + "<p style='font-size:10px;color:#aaa;text-align:center'>"
            + "CAAC System — Blockchain-enabled Context-Aware Access Control<br>"
            + "Northwestern Polytechnical University</p>"
            + "</body></html>";
    }
    private String esc(String s) {
        return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;");
    }
}
