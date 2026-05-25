package org.example.oracle.config;

import io.grpc.Grpc;
import io.grpc.ManagedChannel;
import io.grpc.TlsChannelCredentials;
import org.hyperledger.fabric.client.Gateway;
import org.hyperledger.fabric.client.identity.Identities;
import org.hyperledger.fabric.client.identity.Identity;
import org.hyperledger.fabric.client.identity.Signer;
import org.hyperledger.fabric.client.identity.Signers;
import org.hyperledger.fabric.client.identity.X509Identity;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.security.InvalidKeyException;
import java.security.cert.CertificateException;
import java.util.concurrent.TimeUnit;

@Configuration
public class FabricConfig {

    @Value("${fabric.cryptoPath}")
    private String cryptoPath;

    @Value("${fabric.mspId}")
    private String mspId;

    @Value("${fabric.peerEndpoint}")
    private String peerEndpoint;

    @Value("${fabric.peerOverrideAuthority}")
    private String peerOverrideAuthority;

    @Bean
    public Gateway gateway() throws Exception {
        Path certPath = getFirstFilePath(Paths.get(cryptoPath, "users", "User1@org1.example.com", "msp", "signcerts"));
        Path keyPath = getFirstFilePath(Paths.get(cryptoPath, "users", "User1@org1.example.com", "msp", "keystore"));
        Path tlsCertPath = Paths.get(cryptoPath, "peers", "peer0.org1.example.com", "tls", "ca.crt");

        ManagedChannel channel = newGrpcConnection(tlsCertPath);

        Gateway.Builder builder = Gateway.newInstance()
                .identity(newIdentity(certPath))
                .signer(newSigner(keyPath))
                .connection(channel)
                .evaluateOptions(options -> options.withDeadlineAfter(5, TimeUnit.SECONDS))
                .endorseOptions(options -> options.withDeadlineAfter(15, TimeUnit.SECONDS))
                .submitOptions(options -> options.withDeadlineAfter(5, TimeUnit.SECONDS))
                .commitStatusOptions(options -> options.withDeadlineAfter(1, TimeUnit.MINUTES));

        return builder.connect();
    }

    private ManagedChannel newGrpcConnection(Path tlsCertPath) throws IOException {
        var credentials = TlsChannelCredentials.newBuilder()
                .trustManager(tlsCertPath.toFile())
                .build();
        return Grpc.newChannelBuilder(peerEndpoint, credentials)
                .overrideAuthority(peerOverrideAuthority)
                .build();
    }

    private Identity newIdentity(Path certPath) throws IOException, CertificateException {
        var certReader = Files.newBufferedReader(certPath);
        var certificate = Identities.readX509Certificate(certReader);
        return new X509Identity(mspId, certificate);
    }

    private Signer newSigner(Path keyPath) throws IOException, InvalidKeyException {
        var keyReader = Files.newBufferedReader(keyPath);
        var privateKey = Identities.readPrivateKey(keyReader);
        return Signers.newPrivateKeySigner(privateKey);
    }

    private Path getFirstFilePath(Path dir) throws IOException {
        try (var stream = Files.list(dir)) {
            return stream.findFirst().orElseThrow(() -> new RuntimeException("No file found in " + dir));
        }
    }
}