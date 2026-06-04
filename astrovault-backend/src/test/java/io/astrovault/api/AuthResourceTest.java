package io.astrovault.api;

import io.quarkus.test.junit.QuarkusTest;
import org.junit.jupiter.api.Test;
import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.notNullValue;

@QuarkusTest
class AuthResourceTest {

    @Test
    void loginReturnsToken() {
        given()
                .contentType("application/json")
                .body("{\"username\":\"admin\",\"password\":\"admin\"}")
                .when()
                .post("/api/auth/login")
                .then()
                .statusCode(200)
                .body("token", notNullValue());
    }
}
