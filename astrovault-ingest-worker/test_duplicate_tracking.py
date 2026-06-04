def test_duplicate_tracking_set_behaviour():
    imported = set()
    key = "//host/share/folder/file.fit"
    assert key not in imported
    imported.add(key)
    assert key in imported
