package io.astrovault.api;

import io.astrovault.domain.Frame;
import io.astrovault.domain.FrameType;
import io.astrovault.domain.ImagingSession;
import io.astrovault.domain.ProcessedAsset;
import io.astrovault.domain.ProcessingJob;
import io.astrovault.domain.Target;
import io.astrovault.ingest.FitsHeaderInfo;
import io.astrovault.ingest.SessionAssignmentService;
import io.quarkus.hibernate.orm.panache.Panache;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.narayana.jta.QuarkusTransaction;
import jakarta.inject.Inject;
import jakarta.transaction.Transactional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.time.Instant;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.equalTo;

@QuarkusTest
class SessionManagementTest {

    @Inject
    SessionAssignmentService sessionAssignmentService;

    @BeforeEach
    @Transactional
    void reset() {
        ProcessedAsset.deleteAll();
        ProcessingJob.deleteAll();
        Frame.deleteAll();
        ImagingSession.deleteAll();
        Target.deleteAll();
    }

    @Test
    @Transactional
    void twoLightsSameTargetWithin4hSameSession() {
        Instant t1 = Instant.parse("2026-06-01T20:00:00Z");
        Instant t2 = Instant.parse("2026-06-01T23:30:00Z");
        ImagingSession s1 = sessionAssignmentService.assignSession(new FitsHeaderInfo("M31", "camA", t1, 120L), t1);
        ImagingSession s2 = sessionAssignmentService.assignSession(new FitsHeaderInfo("m31", "camA", t2, 120L), t2);
        org.junit.jupiter.api.Assertions.assertEquals(s1.id, s2.id);
    }

    @Test
    @Transactional
    void twoLightsSameTargetOver4hDifferentSessions() {
        Instant t1 = Instant.parse("2026-06-01T20:00:00Z");
        Instant t2 = Instant.parse("2026-06-02T02:30:00Z");
        ImagingSession s1 = sessionAssignmentService.assignSession(new FitsHeaderInfo("M31", "camA", t1, 120L), t1);
        ImagingSession s2 = sessionAssignmentService.assignSession(new FitsHeaderInfo("M31", "camA", t2, 120L), t2);
        org.junit.jupiter.api.Assertions.assertNotEquals(s1.id, s2.id);
    }

    @Test
    @Transactional
    void crossingMidnightSameNightSameSession() {
        Instant t1 = Instant.parse("2026-06-01T22:00:00Z");
        Instant t2 = Instant.parse("2026-06-02T02:00:00Z");
        ImagingSession s1 = sessionAssignmentService.assignSession(new FitsHeaderInfo("M42", "camA", t1, 180L), t1);
        ImagingSession s2 = sessionAssignmentService.assignSession(new FitsHeaderInfo("M42", "camA", t2, 180L), t2);
        org.junit.jupiter.api.Assertions.assertEquals(s1.id, s2.id);
    }

    @Test
    @Transactional
    void differentTargetDifferentSession() {
        Instant t = Instant.parse("2026-06-01T21:00:00Z");
        ImagingSession s1 = sessionAssignmentService.assignSession(new FitsHeaderInfo("M31", "camA", t, 100L), t);
        ImagingSession s2 = sessionAssignmentService.assignSession(new FitsHeaderInfo("M42", "camA", t.plusSeconds(600), 100L), t.plusSeconds(600));
        org.junit.jupiter.api.Assertions.assertNotEquals(s1.id, s2.id);
    }

    @Test
    void moveFrameRecalculatesIntegration() {
        String token = token();
        final Long[] ids = new Long[3];
        QuarkusTransaction.requiringNew().run(() -> {
            Target target = new Target();
            target.name = "M31";
            target.persist();
            ImagingSession s1 = new ImagingSession();
            s1.target = target;
            s1.totalIntegrationTime = 0L;
            s1.persist();
            ImagingSession s2 = new ImagingSession();
            s2.target = target;
            s2.totalIntegrationTime = 0L;
            s2.persist();
            Frame f = new Frame();
            f.session = s1;
            f.frameType = FrameType.LIGHT;
            f.exposureSeconds = 120L;
            f.observedAt = Instant.parse("2026-06-01T20:00:00Z");
            f.originalFilename = "x.fits";
            f.storageKey = "s";
            f.checksum = "c";
            f.persist();
            sessionAssignmentService.recalculateSession(s1);
            Panache.getEntityManager().flush();
            ids[0] = s1.id;
            ids[1] = s2.id;
            ids[2] = f.id;
        });

        given().header("Authorization", "Bearer " + token)
                .when().post("/api/frames/" + ids[2] + "/move-to-session/" + ids[1])
                .then().statusCode(200);

        given().header("Authorization", "Bearer " + token)
                .when().get("/api/sessions/" + ids[0])
                .then().statusCode(200).body("session.totalIntegrationTime", equalTo(0));

        given().header("Authorization", "Bearer " + token)
                .when().get("/api/sessions/" + ids[1])
                .then().statusCode(200).body("session.totalIntegrationTime", equalTo(120));
    }

    @Test
    void deleteNonEmptySessionFails() {
        String token = token();
        final Long[] ids = new Long[1];
        QuarkusTransaction.requiringNew().run(() -> {
            Target target = new Target();
            target.name = "M31";
            target.persist();
            ImagingSession s1 = new ImagingSession();
            s1.target = target;
            s1.persist();
            Frame f = new Frame();
            f.session = s1;
            f.frameType = FrameType.LIGHT;
            f.originalFilename = "x.fits";
            f.storageKey = "s";
            f.checksum = "c";
            f.persist();
            Panache.getEntityManager().flush();
            ids[0] = s1.id;
        });

        given().header("Authorization", "Bearer " + token)
                .when().delete("/api/sessions/" + ids[0])
                .then().statusCode(409).body(containsString("not empty"));
    }

    private String token() {
        return given().contentType("application/json")
                .body("{\"username\":\"admin\",\"password\":\"admin\"}")
                .when().post("/api/auth/login")
                .then().statusCode(200).extract().path("token");
    }
}
