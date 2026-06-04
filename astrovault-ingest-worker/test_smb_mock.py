import ingest_worker


class FakeStat:
    def __init__(self, is_dir: bool):
        self.st_size = 10
        self.st_mtime = 100.0
        self._is_dir = is_dir


def test_collect_fits_with_mocked_smb(monkeypatch):
    tree = {
        "\\\\h\\s": ["a.fits", "sub", "b.txt"],
        "\\\\h\\s\\sub": ["c.fit"],
    }

    monkeypatch.setattr(ingest_worker, "listdir", lambda p: tree.get(p, []))
    monkeypatch.setattr(ingest_worker.smbpath, "isdir", lambda p: p in tree)
    monkeypatch.setattr(ingest_worker, "lstat", lambda p: FakeStat(p in tree))

    out, stats = ingest_worker.collect_fits("\\\\h\\s", max_depth=8)
    paths = {item.remote for item in out}
    assert "\\\\h\\s\\a.fits" in paths
    assert "\\\\h\\s\\sub\\c.fit" in paths
    assert all(not path.endswith(".txt") for path in paths)
    assert stats.fits_candidates == 2
