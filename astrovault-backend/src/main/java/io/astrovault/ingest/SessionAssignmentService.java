package io.astrovault.ingest;

import io.astrovault.domain.Frame;
import io.astrovault.domain.FrameType;
import io.astrovault.domain.ImagingSession;
import io.astrovault.domain.Target;
import io.astrovault.domain.TargetType;
import jakarta.enterprise.context.ApplicationScoped;
import org.eclipse.microprofile.config.inject.ConfigProperty;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;

@ApplicationScoped
public class SessionAssignmentService {

    @ConfigProperty(name = "astrovault.session.gap-hours", defaultValue = "4")
    long sessionGapHours;

    @ConfigProperty(name = "astrovault.session.night-rollover-hour", defaultValue = "12")
    int nightRolloverHour;

    public ImagingSession unassignedSession() {
        ImagingSession existing = ImagingSession.find("notes", "Unassigned ingest session").firstResult();
        if (existing != null) {
            return existing;
        }
        Target unknown = resolveTarget("unknown");
        ImagingSession created = new ImagingSession();
        created.target = unknown;
        created.notes = "Unassigned ingest session";
        created.totalIntegrationTime = 0L;
        created.persist();
        return created;
    }

    public ImagingSession assignSession(FitsHeaderInfo info, Instant fallbackObservedAt) {
        return assignSession(info, fallbackObservedAt, FrameType.LIGHT);
    }

    public ImagingSession assignSession(FitsHeaderInfo info, Instant fallbackObservedAt, FrameType frameType) {
        Instant observedAt = info.dateObs() == null ? fallbackObservedAt : info.dateObs();
        String normalizedTarget = normalizeTarget(info.objectName());
        LocalDate night = observingNight(observedAt);

        if (frameType != null && frameType != FrameType.LIGHT && "unknown".equals(normalizedTarget)) {
            ImagingSession calibrationSession = findNearbyLightSession(info, observedAt, night);
            if (calibrationSession != null) {
                return calibrationSession;
            }
        }

        Target target = resolveTarget(normalizedTarget);

        List<ImagingSession> sessions = ImagingSession.<ImagingSession>listAll().stream()
                .filter(s -> s.target != null && normalizeTarget(s.target.name).equals(normalizedTarget))
                .filter(s -> s.startTime != null)
                .filter(s -> observingNight(s.startTime).equals(night))
                .toList();

        ImagingSession best = sessions.stream()
                .filter(s -> cameraCompatible(s, info.cameraName()))
                .filter(s -> withinGap(s, observedAt))
                .min(Comparator.comparingLong(s -> distanceSeconds(s, observedAt)))
                .orElse(null);

        if (best != null) {
            return best;
        }

        ImagingSession created = new ImagingSession();
        created.target = target;
        created.startTime = observedAt;
        created.endTime = observedAt;
        created.notes = "Auto-ingest session";
        created.totalIntegrationTime = 0L;
        created.persist();
        return created;
    }

    private ImagingSession findNearbyLightSession(FitsHeaderInfo info, Instant observedAt, LocalDate night) {
        return ImagingSession.<ImagingSession>listAll().stream()
                .filter(s -> s.startTime != null)
                .filter(s -> observingNight(s.startTime).equals(night))
                .filter(s -> cameraCompatible(s, info.cameraName()))
                .filter(s -> withinGap(s, observedAt))
                .filter(this::containsLightFrame)
                .min(Comparator.comparingLong(s -> distanceSeconds(s, observedAt)))
                .orElse(null);
    }

    private boolean containsLightFrame(ImagingSession session) {
        return Frame.<Frame>list("session.id = ?1 and frameType = ?2", session.id, FrameType.LIGHT).stream().findAny().isPresent();
    }

    public void recalculateSession(ImagingSession session) {
        List<Frame> frames = Frame.list("session.id", session.id);
        if (frames.isEmpty()) {
            session.startTime = null;
            session.endTime = null;
            session.totalIntegrationTime = 0L;
            return;
        }
        Instant min = frames.stream().map(f -> f.observedAt).filter(x -> x != null).min(Instant::compareTo).orElse(null);
        Instant max = frames.stream().map(f -> f.observedAt).filter(x -> x != null).max(Instant::compareTo).orElse(null);
        session.startTime = min;
        session.endTime = max;
        long integration = frames.stream()
                .filter(f -> f.frameType == FrameType.LIGHT)
                .map(f -> f.exposureSeconds == null ? 0L : f.exposureSeconds)
                .reduce(0L, Long::sum);
        session.totalIntegrationTime = integration;
    }

    private boolean withinGap(ImagingSession s, Instant observedAt) {
        long gap = sessionGapHours * 3600;
        Instant start = s.startTime == null ? observedAt : s.startTime;
        Instant end = s.endTime == null ? start : s.endTime;
        return !observedAt.isBefore(start.minusSeconds(gap)) && !observedAt.isAfter(end.plusSeconds(gap));
    }

    private long distanceSeconds(ImagingSession s, Instant observedAt) {
        Instant start = s.startTime == null ? observedAt : s.startTime;
        Instant end = s.endTime == null ? start : s.endTime;
        if (observedAt.isBefore(start)) {
            return start.getEpochSecond() - observedAt.getEpochSecond();
        }
        if (observedAt.isAfter(end)) {
            return observedAt.getEpochSecond() - end.getEpochSecond();
        }
        return 0;
    }

    private boolean cameraCompatible(ImagingSession session, String cameraName) {
        if (cameraName == null || cameraName.isBlank()) {
            return true;
        }
        List<Frame> frames = Frame.list("session.id", session.id);
        String existing = frames.stream().map(f -> f.cameraName).filter(v -> v != null && !v.isBlank()).findFirst().orElse(null);
        return existing == null || existing.equalsIgnoreCase(cameraName.trim());
    }

    private Target resolveTarget(String normalizedTarget) {
        Target existing = Target.<Target>listAll().stream()
                .filter(t -> normalizeTarget(t.name).equals(normalizedTarget))
                .findFirst()
                .orElse(null);
        if (existing != null) {
            return existing;
        }
        Target target = new Target();
        target.name = displayName(normalizedTarget);
        target.type = "unknown".equals(normalizedTarget) ? TargetType.Unknown : TargetType.Unknown;
        target.notes = "Auto-ingest target";
        target.persist();
        return target;
    }

    private LocalDate observingNight(Instant instant) {
        return instant.atZone(ZoneId.systemDefault()).minusHours(nightRolloverHour).toLocalDate();
    }

    public String normalizeTarget(String target) {
        if (target == null || target.trim().isEmpty()) {
            return "unknown";
        }
        return target.trim().toLowerCase(Locale.ROOT);
    }

    private String displayName(String normalized) {
        if ("unknown".equals(normalized)) {
            return "Unknown";
        }
        return normalized;
    }
}
