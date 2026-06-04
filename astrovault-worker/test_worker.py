from io import BytesIO

import numpy as np
from astropy.io import fits

from worker import (
    Config,
    build_preview_images,
    enrich_target,
    extract_metadata,
    is_missing_raw_object_error,
    load_openngc_catalog,
    normalize_target_name,
    parse_sexagesimal,
    wikipedia_candidates,
)


def make_test_fits() -> bytes:
    data = (np.random.rand(200, 300) * 5000).astype(np.float32)
    hdu = fits.PrimaryHDU(data=data)
    hdu.header["OBJECT"] = "M31"
    hdu.header["DATE-OBS"] = "2025-10-12T22:00:00"
    hdu.header["EXPTIME"] = 120.0
    hdu.header["GAIN"] = 100
    hdu.header["CCD-TEMP"] = -10.5
    hdu.header["IMAGETYP"] = "LIGHT"
    bio = BytesIO()
    hdu.writeto(bio)
    return bio.getvalue()


def test_extract_metadata():
    metadata, frame_type = extract_metadata(make_test_fits())
    assert frame_type == "LIGHT"
    assert metadata["object"] == "M31"
    assert metadata["exposureTime"] == 120.0
    assert metadata["gain"] == 100


def test_preview_generation_outputs_jpegs():
    preview, thumb = build_preview_images(make_test_fits())
    assert preview[:2] == b"\xff\xd8"
    assert thumb[:2] == b"\xff\xd8"
    assert len(preview) > len(thumb)


def test_missing_raw_object_error_is_permanent():
    class S3Error(Exception):
        code = "NoSuchKey"

    assert is_missing_raw_object_error(S3Error())


def test_other_s3_errors_are_not_permanent():
    class S3Error(Exception):
        code = "SlowDown"

    assert not is_missing_raw_object_error(S3Error())


def test_normalize_target_name_catalogs():
    assert normalize_target_name("Messier M 031") == "M31"
    assert normalize_target_name("ngc 000224") == "NGC224"
    assert normalize_target_name("IC 0342") == "IC342"
    assert normalize_target_name("markarians chain") == "Markarian's Chain"


def test_parse_sexagesimal_preserves_negative_zero_degrees():
    assert round(parse_sexagesimal("-00:30:00.0", hours=False), 3) == -0.5


def test_target_enrichment_fallback_does_not_invent_facts():
    cfg = Config(openngc_url="", wikipedia_enabled=False)
    enrichment = enrich_target(cfg, {"name": "Unknown Object", "ra": 1.2, "dec": 3.4})

    assert enrichment["canonicalName"] == "Unknown Object"
    assert enrichment["ra"] == 1.2
    assert enrichment["dec"] == 3.4
    assert enrichment["objectType"] is None
    assert enrichment["magnitude"] is None
    assert enrichment["source"] == "Not available"


def test_target_enrichment_skips_wikipedia_for_catalog_miss(monkeypatch):
    def fail_if_called(cfg, canonical_name):
        raise AssertionError("Wikipedia should not be queried for catalog misses")

    cfg = Config(openngc_url="", wikipedia_enabled=True)
    monkeypatch.setattr("worker.wikipedia_summary", fail_if_called)

    enrichment = enrich_target(cfg, {"id": 1, "name": "220mm", "ra": None, "dec": None})

    assert enrichment["canonicalName"] == "220mm"
    assert enrichment["description"] is None
    assert enrichment["source"] == "Not available"


def test_target_enrichment_allows_wikipedia_for_known_named_target(monkeypatch):
    def fake_summary(cfg, candidates):
        assert candidates == ["Markarian's Chain"]
        return "A group of galaxies in the Virgo Cluster.", "https://en.wikipedia.org/wiki/Markarian%27s_Chain"

    cfg = Config(openngc_url="", wikipedia_enabled=True)
    monkeypatch.setattr("worker.wikipedia_summary", fake_summary)

    enrichment = enrich_target(cfg, {"id": 2, "name": "Markarians Chain", "ra": None, "dec": None})

    assert enrichment["canonicalName"] == "Markarian's Chain"
    assert enrichment["description"] == "A group of galaxies in the Virgo Cluster."
    assert enrichment["source"] == "Wikipedia summary"


def test_wikipedia_summary_sends_user_agent(monkeypatch):
    captured = {}

    class Response:
        status_code = 404

        def json(self):
            return {}

    def fake_get(url, headers, timeout):
        captured["headers"] = headers
        return Response()

    monkeypatch.setattr("worker.requests.get", fake_get)

    assert __import__("worker").wikipedia_summary(Config(wikipedia_enabled=True), ["M31"]) is None
    assert captured["headers"]["User-Agent"].startswith("AstroVault/")


def test_wikipedia_candidates_include_messier_name_for_ngc_messier_object():
    candidates = wikipedia_candidates({"canonicalName": "NGC4406", "catalogIds": "M86"})

    assert candidates == ["NGC4406", "M86", "Messier 86"]


def test_openngc_catalog_parses_semicolon_csv(monkeypatch):
    class Response:
        text = (
            "Name;Type;RA;Dec;Const;MajAx;V-Mag;M;NGC;IC\n"
            "NGC0224;G;00:42:44.35;+41:16:08.6;And;177.8;3.44;031;0224;\n"
            "IC0001;G;00:08:27.05;+27:43:03.6;Peg;1.2;14.2;;;0001\n"
        )

        def raise_for_status(self):
            return None

    def fake_get(url, headers, timeout):
        return Response()

    load_openngc_catalog.cache_clear()
    monkeypatch.setattr("worker.requests.get", fake_get)

    catalog = load_openngc_catalog("https://example.test/NGC.csv")

    assert catalog["M31"]["canonicalName"] == "NGC0224"
    assert catalog["NGC224"]["catalogIds"] == "M31, NGC224"
    assert round(catalog["NGC224"]["ra"], 3) == 10.685
    assert round(catalog["NGC224"]["dec"], 3) == 41.269
    assert catalog["NGC224"]["magnitude"] == 3.44
    assert catalog["IC1"]["canonicalName"] == "IC0001"
