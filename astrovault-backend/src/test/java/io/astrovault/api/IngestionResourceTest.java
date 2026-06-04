package io.astrovault.api;

import io.astrovault.domain.ImagingSession;
import io.astrovault.domain.Target;
import io.astrovault.domain.TargetType;
import io.quarkus.test.junit.QuarkusTest;
import jakarta.transaction.Transactional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.equalTo;

@QuarkusTest
class IngestionResourceTest {

    private static Long sessionId;

    @BeforeEach
    @Transactional
    void setupData() {
        if (sessionId != null) {
            return;
        }
        Target target = new Target();
        target.name = "M42";
        target.type = TargetType.EmissionNebula;
        target.persist();

        ImagingSession session = new ImagingSession();
        session.target = target;
        session.persist();
        sessionId = session.id;
    }

    @Test
    void importCreatesFrameAndJobs() {
        String token = given()
                .contentType("application/json")
                .body("{\"username\":\"admin\",\"password\":\"admin\"}")
                .when()
                .post("/api/auth/login")
                .then()
                .statusCode(200)
                .extract()
                .path("token");

        String payload = "{\"sessionId\":" + sessionId
                + ",\"originalFilename\":\"light_001.fits\""
                + ",\"storageKey\":\"key-1\""
                + ",\"checksum\":\"abc123\""
                + ",\"frameType\":\"LIGHT\"}";

        given()
                .contentType("application/json")
                .header("Authorization", "Bearer " + token)
                .body(payload)
                .when()
                .post("/api/ingestion/frames")
                .then()
                .statusCode(200)
                .body("originalFilename", equalTo("light_001.fits"));

        given()
                .contentType("application/json")
                .header("Authorization", "Bearer " + token)
                .when()
                .get("/api/jobs")
                .then()
                .statusCode(200)
                .body("size()", equalTo(2));
    }
}
