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
    monkeypatch.setattr(ingest_worker.smbpath, "join", lambda a, b: f"{a}\\{b}")
    monkeypatch.setattr(ingest_worker.smbpath, "isdir", lambda p: p in tree)
    monkeypatch.setattr(ingest_worker, "lstat", lambda p: FakeStat(p in tree))

    out = ingest_worker.collect_fits("\\\\h\\s")
    assert "\\\\h\\s\\a.fits" in out
    assert "\\\\h\\s\\sub\\c.fit" in out
    assert all(not x.endswith(".txt") for x in out)
