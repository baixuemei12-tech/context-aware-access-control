package org.example.oracle;

import org.hyperledger.fabric.client.Gateway;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;

@SpringBootTest(
        classes = OracleApplication.class,
        properties = "oracle.hmac.key=test-hmac-key"
)
class OracleApplicationTests {

    @MockBean
    private Gateway gateway;

    @Test
    void contextLoads() {
    }
}
