"""
uploads.video_info — a video's length and codec, read straight from the MP4/MOV headers.

No video library is needed: an MP4/MOV is a list of "boxes", and the movie header box (moov/mvhd) holds the length
while the first video track's sample description (moov/trak/mdia/minf/stbl/stsd) names the codec. Only the headers are
read (the media itself is skipped over), so this is cheap even for a 500 MB file. It cannot decode anything, so it
says nothing about whether a video plays, only how long it is and which codec it uses.
"""
import struct
from dataclasses import dataclass

# A movie box is a few MB at most, even for a long clip; anything larger is not read into memory.
_MAX_MOOV_BYTES = 64 * 1024 * 1024
_MAX_TOP_LEVEL_BOXES = 5000
_H264 = {b"avc1", b"avc3"}
_HEVC = {b"hvc1", b"hev1", b"dvh1", b"dvhe"}


@dataclass(frozen=True)
class VideoInfo:
    duration_seconds: float | None  # None when the file does not state it (e.g. fragmented MP4)
    codec: str  # "h264", "hevc", "other", or "" when there is no readable video track


def read_video_info(file) -> VideoInfo | None:
    """The video's length and codec, or None when the file has no readable movie header. The file is rewound."""
    try:
        movie = _read_movie_box(file)
    finally:
        file.seek(0)
    if movie is None:
        return None
    return VideoInfo(duration_seconds=_duration(movie), codec=_codec(movie))


def _read_movie_box(file) -> bytes | None:
    file.seek(0, 2)
    end = file.tell()
    offset = 0
    for _ in range(_MAX_TOP_LEVEL_BOXES):
        if offset + 8 > end:
            return None
        file.seek(offset)
        header = file.read(16)
        if len(header) < 8:
            return None
        size, kind = struct.unpack(">I4s", header[:8])
        header_length = 8
        if size == 1:  # 64-bit size follows the type
            if len(header) < 16:
                return None
            size = struct.unpack(">Q", header[8:16])[0]
            header_length = 16
        elif size == 0:  # the box runs to the end of the file
            size = end - offset
        if size < header_length:
            return None
        if kind == b"moov":
            payload = size - header_length
            if payload > _MAX_MOOV_BYTES or offset + size > end:
                return None
            file.seek(offset + header_length)
            data = file.read(payload)
            return data if len(data) == payload else None
        offset += size
    return None


def _boxes(buf: bytes, start: int, end: int):
    """(type, payload_start, payload_end) of each box in buf[start:end]; stops at the first malformed one."""
    pos = start
    while pos + 8 <= end:
        size, kind = struct.unpack_from(">I4s", buf, pos)
        header_length = 8
        if size == 1:
            if pos + 16 > end:
                return
            size = struct.unpack_from(">Q", buf, pos + 8)[0]
            header_length = 16
        elif size == 0:
            size = end - pos
        if size < header_length or pos + size > end:
            return
        yield kind, pos + header_length, pos + size
        pos += size


def _child(buf: bytes, box: tuple[int, int], kind: bytes) -> tuple[int, int] | None:
    for found, start, end in _boxes(buf, *box):
        if found == kind:
            return start, end
    return None


def _duration(movie: bytes) -> float | None:
    header = _child(movie, (0, len(movie)), b"mvhd")
    if header is None:
        return None
    start, end = header
    if start >= end:
        return None
    if movie[start] == 1:  # version 1 uses 64-bit times
        if start + 32 > end:
            return None
        timescale = struct.unpack_from(">I", movie, start + 20)[0]
        duration = struct.unpack_from(">Q", movie, start + 24)[0]
        unknown = 0xFFFFFFFFFFFFFFFF
    else:
        if start + 20 > end:
            return None
        timescale = struct.unpack_from(">I", movie, start + 12)[0]
        duration = struct.unpack_from(">I", movie, start + 16)[0]
        unknown = 0xFFFFFFFF
    if timescale == 0 or duration in (0, unknown):
        return None
    return duration / timescale


def _codec(movie: bytes) -> str:
    for kind, start, end in _boxes(movie, 0, len(movie)):
        if kind != b"trak":
            continue
        media = _child(movie, (start, end), b"mdia")
        if media is None:
            continue
        handler = _child(movie, media, b"hdlr")
        # hdlr: version/flags (4), pre_defined (4), then the handler type: "vide" for a video track.
        if handler is None or handler[0] + 12 > handler[1] or movie[handler[0] + 8:handler[0] + 12] != b"vide":
            continue
        info = _child(movie, media, b"minf")
        table = _child(movie, info, b"stbl") if info else None
        descriptions = _child(movie, table, b"stsd") if table else None
        # stsd: version/flags (4), entry count (4), then the first entry: size (4) and its format (4).
        if descriptions is None or descriptions[0] + 16 > descriptions[1]:
            return "other"
        entry = movie[descriptions[0] + 12:descriptions[0] + 16]
        return "h264" if entry in _H264 else "hevc" if entry in _HEVC else "other"
    return ""
