package io.astrovault.api;

import io.smallrye.jwt.build.Jwt;
import jakarta.annotation.security.PermitAll;
import jakarta.annotation.security.RolesAllowed;
import jakarta.inject.Inject;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.HeaderParam;
import jakarta.ws.rs.WebApplicationException;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.Response;
import jakarta.ws.rs.core.MediaType;
import org.eclipse.microprofile.config.inject.ConfigProperty;

import java.util.HashMap;
import java.util.Map;
import java.util.Set;

@Path("/api/auth")
@Consumes(MediaType.APPLICATION_JSON)
@Produces(MediaType.APPLICATION_JSON)
public class AuthResource {

    @Inject
    @ConfigProperty(name = "astrovault.auth.admin.password")
    String adminPassword;

    @Inject
    @ConfigProperty(name = "astrovault.auth.user.password")
    String userPassword;

    @Inject
    @ConfigProperty(name = "astrovault.auth.viewer.password")
    String viewerPassword;

    public record LoginRequest(String username, String password) {}
    public record LoginResponse(String token, String role) {}

    private static final String SESSION_COOKIE = "astrovault_token";

    @POST
    @Path("/login")
    @PermitAll
    public Response login(LoginRequest req) {
        if (req == null || req.username() == null || req.password() == null) {
            throw new WebApplicationException("Invalid credentials", Response.Status.UNAUTHORIZED);
        }

        Map<String, String> expectedPasswords = new HashMap<>();
        expectedPasswords.put("admin", adminPassword);
        expectedPasswords.put("user", userPassword);
        expectedPasswords.put("viewer", viewerPassword);

        String expectedPassword = expectedPasswords.get(req.username());
        if (expectedPassword == null || !expectedPassword.equals(req.password())) {
            throw new WebApplicationException("Invalid credentials", Response.Status.UNAUTHORIZED);
        }

        String role = switch (req.username()) {
            case "admin" -> "ADMIN";
            case "user" -> "USER";
            case "viewer" -> "VIEWER";
            default -> throw new WebApplicationException("Invalid credentials", Response.Status.UNAUTHORIZED);
        };

        String token = Jwt.issuer("astrovault")
                .upn(req.username())
                .groups(Set.of(role))
                .expiresIn(3600)
                .sign();
        return Response.ok(new LoginResponse(token, role))
                .header("Set-Cookie", SESSION_COOKIE + "=" + token + "; Path=/; Max-Age=3600; HttpOnly; SameSite=Lax")
                .build();
    }

    @POST
    @Path("/logout")
    @PermitAll
    public Response logout() {
        return Response.noContent()
                .header("Set-Cookie", SESSION_COOKIE + "=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax")
                .build();
    }

    @POST
    @Path("/session-cookie")
    @RolesAllowed({"ADMIN", "USER", "VIEWER"})
    public Response refreshSessionCookie(@HeaderParam("Authorization") String authorization) {
        String token = bearerToken(authorization);
        if (token == null) {
            throw new WebApplicationException("Missing bearer token", Response.Status.UNAUTHORIZED);
        }
        return Response.noContent()
                .header("Set-Cookie", SESSION_COOKIE + "=" + token + "; Path=/; Max-Age=3600; HttpOnly; SameSite=Lax")
                .build();
    }

    private String bearerToken(String authorization) {
        if (authorization == null || !authorization.regionMatches(true, 0, "Bearer ", 0, 7)) {
            return null;
        }
        String token = authorization.substring(7).trim();
        return token.isBlank() ? null : token;
    }
}
