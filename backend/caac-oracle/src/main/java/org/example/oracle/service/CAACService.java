package org.example.oracle.service;

import org.hyperledger.fabric.client.Contract;
import org.hyperledger.fabric.client.Gateway;
import org.hyperledger.fabric.client.Network;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import java.nio.charset.StandardCharsets;

@Service
public class CAACService {

    private final Gateway gateway;

    @Value("${fabric.channelName}")
    private String channelName;

    @Value("${fabric.chaincodeName}")
    private String chaincodeName;

    public CAACService(Gateway gateway) {
        this.gateway = gateway;
    }

    public String evaluateAccessRequest(
            String rSub, String tSub, String bFreq,
            String sLevel, String pReq,
            String lTrust, String nStatus, String dSec, String tReq,
            String w1, String w2, String w3,
            String alpha, String beta, String lambda, String tau) {
        try {
            Network network = gateway.getNetwork(channelName);
            Contract contract = network.getContract(chaincodeName);
            byte[] result = contract.evaluateTransaction("evaluateAccess", rSub, tSub,
                    bFreq, sLevel, pReq, lTrust, nStatus, dSec,
                    tReq, w1, w2, w3, alpha, beta, lambda, tau);
            return new String(result, StandardCharsets.UTF_8) + "\n";
        } catch (Exception e) {
            throw new RuntimeException("Error evaluating access request from chaincode", e);
        }
    }

    public String submitReceipt(String sessionHash, String userHash, String fileId,
                                String rgcaTier, String bytesDelivered,
                                String wasRevoked, String leakageBound,
                                String budgetUsed, String budgetLimit,
                                String clusterRisk, String compliant) {
        try {
            Network network = gateway.getNetwork(channelName);
            Contract contract = network.getContract(chaincodeName);
            contract.submitTransaction("recordSessionReceipt",
                    sessionHash, userHash, fileId, rgcaTier, bytesDelivered,
                    wasRevoked, leakageBound, budgetUsed, budgetLimit,
                    clusterRisk, compliant);
            System.out.println("[CAAR-Oracle] Receipt submitted: " + sessionHash
                    + " | compliant=" + compliant);
            return "OK";
        } catch (Exception e) {
            System.err.println("[CAAR-Oracle] Receipt submission failed: " + e.getMessage());
            return "ERROR";
        }
    }

    public String getReceipt(String sessionHash) {
        try {
            Network network = gateway.getNetwork(channelName);
            Contract contract = network.getContract(chaincodeName);
            byte[] result = contract.evaluateTransaction("getSessionReceipt", sessionHash);
            return new String(result, StandardCharsets.UTF_8);
        } catch (Exception e) {
            System.err.println("[CAAR-Oracle] Receipt query failed: " + e.getMessage());
            return "ERROR";
        }
    }
}
