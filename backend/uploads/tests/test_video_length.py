"""A video's length and codec are read from its headers; the short-video feed refuses clips that are too long."""
import struct

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from identity.models import User
from uploads.services import MediaTooLargeError, UnsupportedMediaTypeError, VideoTooLongError, check_video_length
from uploads.video_info import read_video_info


def _box(kind: bytes, payload: bytes = b"") -> bytes:
    return struct.pack(">I4s", 8 + len(payload), kind) + payload


def _mvhd(seconds: int, timescale: int = 1000, version: int = 0) -> bytes:
    if version == 1:
        return _box(b"mvhd", struct.pack(">B3xQQIQ", 1, 0, 0, timescale, seconds * timescale) + b"\x00" * 80)
    return _box(b"mvhd", struct.pack(">B3xIIII", 0, 0, 0, timescale, seconds * timescale) + b"\x00" * 80)


def _video_track(codec: bytes) -> bytes:
    handler = _box(b"hdlr", b"\x00" * 4 + b"\x00" * 4 + b"vide" + b"\x00" * 12 + b"VideoHandler\x00")
    description = _box(b"stsd", b"\x00" * 4 + struct.pack(">I", 1) + _box(codec, b"\x00" * 78))
    return _box(b"trak", _box(b"mdia", handler + _box(b"minf", _box(b"stbl", description))))


def make_mp4(seconds: int = 10, codec: bytes = b"avc1", version: int = 0) -> bytes:
    return (
        _box(b"ftyp", b"isom\x00\x00\x02\x00isomiso2mp41")
        + _box(b"mdat", b"\x01" * 64)  # the media itself, which must be skipped over
        + _box(b"moov", _mvhd(seconds, version=version) + _video_track(codec))
    )


def _upload(name: str, data: bytes) -> SimpleUploadedFile:
    return SimpleUploadedFile(name, data, content_type="video/mp4")


def test_length_and_codec_are_read_from_the_headers():
    info = read_video_info(_upload("a.mp4", make_mp4(42)))
    assert info.duration_seconds == 42
    assert info.codec == "h264"


def test_a_phone_recording_in_hevc_is_recognised():
    assert read_video_info(_upload("a.mov", make_mp4(5, codec=b"hvc1"))).codec == "hevc"
    assert read_video_info(_upload("a.mov", make_mp4(5, codec=b"vp09"))).codec == "other"


def test_64_bit_headers_are_read_too():
    assert read_video_info(_upload("a.mp4", make_mp4(90, version=1))).duration_seconds == 90


def test_a_file_without_a_movie_header_is_unreadable():
    assert read_video_info(_upload("a.mp4", _box(b"ftyp", b"isom\x00\x00\x02\x00") + _box(b"mdat", b"\x01" * 64))) is None
    assert read_video_info(_upload("a.mp4", b"\x00\x00\x00\x18ftypmp42" + b"\x00" * 32)) is None


def test_a_video_with_no_stated_length_gives_none():
    movie = _box(b"moov", _mvhd(0) + _video_track(b"avc1"))
    assert read_video_info(_upload("a.mp4", _box(b"ftyp", b"isom\x00\x00\x02\x00") + movie)).duration_seconds is None


def test_a_video_over_the_limit_is_refused_in_the_feed_folder(settings):
    settings.FEED_VIDEO_MAX_SECONDS = 60
    with pytest.raises(VideoTooLongError, match=r"This video is 1 min 01 s long — videos here can be at most 1 min 00 s\."):
        check_video_length(_upload("a.mp4", make_mp4(61)), folder="videos")
    assert check_video_length(_upload("a.mp4", make_mp4(60)), folder="videos").duration_seconds == 60
    # Callers that already report a refused upload report this one too.
    assert issubclass(VideoTooLongError, MediaTooLargeError)


def test_other_folders_have_no_length_limit(settings):
    settings.FEED_VIDEO_MAX_SECONDS = 10
    assert check_video_length(_upload("a.mp4", make_mp4(3600)), folder="agent-intro").duration_seconds == 3600


def test_a_feed_video_whose_length_cannot_be_read_is_refused():
    with pytest.raises(UnsupportedMediaTypeError, match="couldn't read this video's length"):
        check_video_length(_upload("a.mp4", b"\x00\x00\x00\x18ftypmp42" + b"\x00" * 32), folder="videos")


def _client(username: str, phone: str) -> APIClient:
    client = APIClient()
    token = RefreshToken.for_user(User.objects.create(username=username, phone=phone))
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    return client


@pytest.mark.django_db
def test_the_upload_reports_the_videos_length_and_codec(settings, tmp_path):
    settings.MEDIA_ROOT = tmp_path
    response = _client("len_ok", "+237699111201").post(
        "/api/media/upload/", {"file": _upload("a.mov", make_mp4(30, codec=b"hvc1")), "folder": "videos"}, format="multipart",
    )

    assert response.status_code == 201
    assert response.data["media_type"] == "VIDEO"
    assert response.data["duration_seconds"] == 30
    assert response.data["video_codec"] == "hevc"


@pytest.mark.django_db
def test_a_too_long_video_is_refused_with_the_reason_in_the_language_asked_for(settings, tmp_path):
    settings.MEDIA_ROOT = tmp_path
    settings.FEED_VIDEO_MAX_SECONDS = 120
    client = _client("len_long", "+237699111202")
    data = {"file": _upload("a.mp4", make_mp4(300)), "folder": "videos"}

    english = client.post("/api/media/upload/", data, format="multipart")
    assert english.status_code == 400
    assert english.data["detail"] == "This video is 5 min 00 s long — videos here can be at most 2 min 00 s."

    data["file"] = _upload("a.mp4", make_mp4(300))
    french = client.post("/api/media/upload/", data, format="multipart", HTTP_ACCEPT_LANGUAGE="fr")
    assert french.json()["detail"] == "Cette vidéo dure 5 min 00 s — les vidéos ici ne peuvent pas dépasser 2 min 00 s."
    assert list(tmp_path.rglob("*.mp4")) == []  # nothing is stored for a refused video
