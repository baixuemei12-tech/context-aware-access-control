package org.example.gateway.controller;

import jakarta.servlet.http.HttpServletRequest;
import org.example.gateway.config.CaacBudgetProperties;
import org.example.gateway.config.FileRegistry;
import org.example.gateway.model.AccessRequest;
import org.example.gateway.model.OracleResult;
import org.example.gateway.model.RawContext;
import org.example.gateway.model.User;
import org.example.gateway.service.AnomalyDetector;
import org.example.gateway.service.AuditService;
import org.example.gateway.service.ContextResolverService;
import org.example.gateway.service.IpfsService;
import org.example.gateway.service.LiveEventService;
import org.example.gateway.service.OracleClient;
import org.example.gateway.service.RevocationScheduler;
import org.example.gateway.service.RiskBudgetService;
import org.example.gateway.service.SessionManager;
import org.example.gateway.service.TotpService;
import org.example.gateway.service.UserService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.Collections;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyDouble;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Verifies that every audit-log emission point in FileAccessController.webAccess
 * also pushes a FILE_ACCESS event to the live SSE stream — that's what drives
 * the admin runtime topology cascade on the frontend.
 */
class FileAccessControllerEventsTest {

    private OracleClient oracleClient;
    private SessionManager sessionManager;
    private ContextResolverService contextResolver;
    private FileRegistry fileRegistry;
    private UserService userService;
    private TotpService totpService;
    private IpfsService ipfsService;
    private AuditService auditService;
    private AnomalyDetector anomalyDetector;
    private RiskBudgetService riskBudgetService;
    private RevocationScheduler revocationScheduler;
    private LiveEventService liveEventService;
    private CaacBudgetProperties budgetProps;

    private FileAccessController controller;

    @BeforeEach
    void setUp() {
        oracleClient = mock(OracleClient.class);
        sessionManager = mock(SessionManager.class);
        contextResolver = mock(ContextResolverService.class);
        fileRegistry = mock(FileRegistry.class);
        userService = mock(UserService.class);
        totpService = mock(TotpService.class);
        ipfsService = mock(IpfsService.class);
        auditService = mock(AuditService.class);
        anomalyDetector = mock(AnomalyDetector.class);
        riskBudgetService = mock(RiskBudgetService.class);
        revocationScheduler = mock(RevocationScheduler.class);
        liveEventService = mock(LiveEventService.class);
        budgetProps = mock(CaacBudgetProperties.class);

        // budgetProps defaults so computeWindowBudget doesn't divide by zero
        when(budgetProps.getMuLow()).thenReturn(1.0);
        when(budgetProps.getMuMedium()).thenReturn(1.0);
        when(budgetProps.getMuHigh()).thenReturn(1.0);
        when(budgetProps.getThetaLow()).thenReturn(0.5);
        when(budgetProps.getThetaMedium()).thenReturn(0.5);
        when(budgetProps.getThetaHigh()).thenReturn(0.5);
        when(budgetProps.getPsiLow()).thenReturn(0.1);
        when(budgetProps.getPsiMedium()).thenReturn(0.1);
        when(budgetProps.getPsiHigh()).thenReturn(0.1);
        when(budgetProps.getKappa()).thenReturn(1.0);
        when(budgetProps.getBMaxLowBytes()).thenReturn(1024L * 1024);
        when(budgetProps.getBMaxMediumBytes()).thenReturn(1024L * 1024);
        when(budgetProps.getBMaxHighBytes()).thenReturn(1024L * 1024);

        controller = new FileAccessController(
                oracleClient, sessionManager, contextResolver, fileRegistry,
                userService, totpService, ipfsService, auditService,
                anomalyDetector, riskBudgetService, revocationScheduler,
                liveEventService
        );
        ReflectionTestUtils.setField(controller, "budgetProps", budgetProps);
    }

    private User authedUser(String username, int rSub, double tSub) {
        User u = new User();
        u.setUsername(username);
        u.setRSub(rSub);
        u.setTSub(tSub);
        u.setStatus(User.Status.ACTIVE);
        return u;
    }

    private RawContext sampleContext() {
        RawContext c = new RawContext();
        c.setNetworkType("wifi");
        c.setPlatform("Linux x86_64");
        c.setScreenWidth(1920);
        c.setScreenHeight(1080);
        c.setTimezone("Asia/Shanghai");
        c.setLanguage("en-US");
        c.setUserAgent("Mozilla/5.0");
        return c;
    }

    private FileRegistry.FileEntry realFile(String fileId, int sLevel, double pReq) {
        FileRegistry.FileEntry entry = new FileRegistry.FileEntry(
                fileId, "Qm-fake", sLevel, pReq,
                "test file", FileRegistry.FileStatus.APPROVED, "uploader"
        );
        entry.setFileSize(2048);
        entry.setRulesJson("[]");
        return entry;
    }

    private AccessRequest fakeResolvedRequest() {
        AccessRequest r = new AccessRequest();
        r.setLTrust("0.8");
        r.setNStatus("0.7");
        r.setDSec("0.85");
        r.setTReq("0.9");
        r.setRSub("4");
        r.setTSub("0.75");
        r.setBFreq("0.5");
        return r;
    }

    private HttpServletRequest req(String remote) {
        HttpServletRequest r = mock(HttpServletRequest.class);
        when(r.getRemoteAddr()).thenReturn(remote);
        when(r.getHeader("X-Forwarded-For")).thenReturn(null);
        when(r.getHeader("X-Real-IP")).thenReturn(null);
        return r;
    }

    @SuppressWarnings("unchecked")
    private static ArgumentCaptor<Map<String, Object>> payloadCaptor() {
        return (ArgumentCaptor<Map<String, Object>>) (ArgumentCaptor<?>) ArgumentCaptor.forClass(Map.class);
    }

    // -----------------------------------------------------------------
    // DENY: subnet-blocked path (audit-log site ~191)
    // -----------------------------------------------------------------
    @Test
    void subnetBlockedDeny_emitsFileAccessEvent() {
        User user = authedUser("alice", 3, 0.7);
        when(userService.getUserByToken(anyString())).thenReturn(user);
        when(userService.isAdmin(user)).thenReturn(false);
        when(anomalyDetector.isBlocked("alice")).thenReturn(0L);
        when(fileRegistry.get("file-1")).thenReturn(realFile("file-1", 2, 0.6));
        when(revocationScheduler.isSubnetBlocked(anyString())).thenReturn(true);
        when(revocationScheduler.getSubnetBlockExpiry(anyString()))
                .thenReturn(System.currentTimeMillis() + 60_000);

        controller.webAccess("file-1", sampleContext(), req("10.0.0.5"), "Bearer x");

        ArgumentCaptor<Map<String, Object>> c = payloadCaptor();
        verify(liveEventService).publishFileAccess(eq("alice"), c.capture());
        Map<String, Object> data = c.getValue();
        assertEquals("DENY", data.get("decision"),
                "subnet-blocked path must mark decision=DENY on the live event");
        assertEquals("file-1", data.get("fileId"));
        assertNotNull(data.get("reason"));
    }

    // -----------------------------------------------------------------
    // DENY: Oracle returns DENY (audit-log site ~264)
    // -----------------------------------------------------------------
    @Test
    void oracleDeny_emitsFileAccessEvent() {
        User user = authedUser("alice", 3, 0.7);
        when(userService.getUserByToken(anyString())).thenReturn(user);
        when(userService.isAdmin(user)).thenReturn(false);
        when(anomalyDetector.isBlocked("alice")).thenReturn(0L);
        when(fileRegistry.get("file-1")).thenReturn(realFile("file-1", 2, 0.6));
        when(revocationScheduler.isSubnetBlocked(anyString())).thenReturn(false);

        when(contextResolver.computeObjectRisk(anyInt(), anyLong(), anyString())).thenReturn(0.1);
        when(contextResolver.computeEffectiveThreshold(anyDouble(), anyDouble())).thenReturn(0.6);
        when(contextResolver.resolve(any(), anyString(), any())).thenReturn(fakeResolvedRequest());
        when(sessionManager.getEvolvedTSub(anyString(), anyDouble())).thenReturn(0.75);

        when(oracleClient.evaluate(any())).thenReturn(new OracleResult("DENY", 0.41, 0.32));

        controller.webAccess("file-1", sampleContext(), req("10.0.0.5"), "Bearer x");

        ArgumentCaptor<Map<String, Object>> c = payloadCaptor();
        verify(liveEventService).publishFileAccess(eq("alice"), c.capture());
        Map<String, Object> data = c.getValue();
        assertEquals("DENY", data.get("decision"));
        assertEquals(0.41, data.get("dtScore"));
        assertEquals(0.32, data.get("ceScore"));
    }

    // -----------------------------------------------------------------
    // PERMIT: full happy path (audit-log site ~363)
    // -----------------------------------------------------------------
    @Test
    void oraclePermit_emitsFileAccessEventWithSessionId() {
        User user = authedUser("alice", 4, 0.75);
        when(userService.getUserByToken(anyString())).thenReturn(user);
        when(userService.isAdmin(user)).thenReturn(false);
        when(anomalyDetector.isBlocked("alice")).thenReturn(0L);
        when(anomalyDetector.recordAccess(anyString(), anyInt(), anyDouble()))
                .thenReturn(Collections.emptyList());

        FileRegistry.FileEntry file = realFile("file-1", 2, 0.5);
        when(fileRegistry.get("file-1")).thenReturn(file);
        when(revocationScheduler.isSubnetBlocked(anyString())).thenReturn(false);
        when(contextResolver.computeObjectRisk(anyInt(), anyLong(), anyString())).thenReturn(0.1);
        when(contextResolver.computeEffectiveThreshold(anyDouble(), anyDouble())).thenReturn(0.5);
        when(contextResolver.resolve(any(), anyString(), any())).thenReturn(fakeResolvedRequest());
        when(sessionManager.getEvolvedTSub(anyString(), anyDouble())).thenReturn(0.75);

        when(oracleClient.evaluate(any())).thenReturn(new OracleResult("PERMIT", 0.81, 0.74));

        when(riskBudgetService.checkBudget(anyString(), anyString(), anyDouble(), anyLong(), anyBoolean()))
                .thenReturn("OK");
        when(riskBudgetService.computeBudget(anyDouble(), anyLong(), anyBoolean())).thenReturn(8192L);
        when(riskBudgetService.getCumulativeLeakage(anyString(), anyString())).thenReturn(0L);

        SessionManager.ActiveSession sess = mock(SessionManager.ActiveSession.class);
        when(sess.riskMargin()).thenReturn(0.31);
        when(sessionManager.register(anyString(), eq("file-1"), any(), eq("alice"))).thenReturn(sess);

        controller.webAccess("file-1", sampleContext(), req("10.0.0.5"), "Bearer x");

        ArgumentCaptor<Map<String, Object>> c = payloadCaptor();
        verify(liveEventService).publishFileAccess(eq("alice"), c.capture());
        Map<String, Object> data = c.getValue();
        assertEquals("PERMIT", data.get("decision"));
        assertEquals(0.81, data.get("dtScore"));
        assertEquals(0.74, data.get("ceScore"));
        assertNotNull(data.get("sessionId"),
                "PERMIT emission must carry the freshly-minted sessionId");
        assertNotNull(data.get("riskMargin"));
    }

    // -----------------------------------------------------------------
    // ERROR: Oracle unreachable (audit-log site ~274)
    // -----------------------------------------------------------------
    @Test
    void oracleError_emitsFileAccessEventWithErrorDecision() {
        User user = authedUser("alice", 3, 0.7);
        when(userService.getUserByToken(anyString())).thenReturn(user);
        when(userService.isAdmin(user)).thenReturn(false);
        when(anomalyDetector.isBlocked("alice")).thenReturn(0L);
        when(fileRegistry.get("file-1")).thenReturn(realFile("file-1", 2, 0.6));
        when(revocationScheduler.isSubnetBlocked(anyString())).thenReturn(false);

        when(contextResolver.computeObjectRisk(anyInt(), anyLong(), anyString())).thenReturn(0.1);
        when(contextResolver.computeEffectiveThreshold(anyDouble(), anyDouble())).thenReturn(0.6);
        when(contextResolver.resolve(any(), anyString(), any())).thenReturn(fakeResolvedRequest());
        when(sessionManager.getEvolvedTSub(anyString(), anyDouble())).thenReturn(0.75);

        // Anything other than PERMIT/DENY → OracleResult.isError() == true
        when(oracleClient.evaluate(any())).thenReturn(new OracleResult("UNREACHABLE", 0.0, 0.0));

        controller.webAccess("file-1", sampleContext(), req("10.0.0.5"), "Bearer x");

        ArgumentCaptor<Map<String, Object>> c = payloadCaptor();
        verify(liveEventService).publishFileAccess(eq("alice"), c.capture());
        assertEquals("ERROR", c.getValue().get("decision"),
                "oracle-unreachable path must mark decision=ERROR on the live event");
    }

    // -----------------------------------------------------------------
    // Pre-auth failures must NOT emit (auth comes before audit)
    // -----------------------------------------------------------------
    @Test
    void unauthenticated_emitsNoFileAccessEvent() {
        when(userService.getUserByToken(anyString())).thenReturn(null);

        controller.webAccess("file-1", sampleContext(), req("10.0.0.5"), null);

        verify(liveEventService, never()).publishFileAccess(anyString(), any());
    }
}
