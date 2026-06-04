from io import BytesIO

import numpy as np
from astropy.io import fits

from worker import build_preview_images, extract_metadata


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
