from ingest_worker import StableTracker


def test_stable_detection_waits_for_second_seen_and_age():
    t = StableTracker(stable_seconds=10)
    now = 1000.0
    assert t.is_stable("a", 100, 995.0, now) is False
    assert t.is_stable("a", 100, 995.0, now + 1) is False
    assert t.is_stable("a", 100, 995.0, now + 12) is True


def test_stable_detection_resets_on_size_change():
    t = StableTracker(stable_seconds=5)
    assert t.is_stable("b", 10, 100.0, 106.0) is False
    assert t.is_stable("b", 10, 100.0, 107.0) is True
    assert t.is_stable("b", 11, 101.0, 108.0) is False
