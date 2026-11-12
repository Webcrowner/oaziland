"""
careers.certificate_templates — admin-designed course certificates.

A template is a page (landscape or portrait A4) with an optional uploaded background — e.g. a blank certificate
designed elsewhere — and a list of elements the system draws on top when it issues a certificate:

    text  — any wording, with {placeholders} filled per certificate (see PLACEHOLDERS), in English and French
    logo  — the template's logo (or the Oaziland logo), resizable
    signature — the template's signature (drawn in the designer or uploaded), resizable; not drawn while there is none
    qr    — a QR code to the public verification page
    line  — e.g. a signature line
    rect  — e.g. a decorative frame

Positions and sizes are in "design units": the page is always 1000 units wide and 707 (landscape) or 1414
(portrait) units tall, so the same numbers drive the web designer and the 300 DPI print rendering.
Text boxes are anchored at their top-left corner; each line is vertically centred in a 1.2 × font-size line box,
like CSS `line-height: 1.2`, so the designer preview matches the printed result.
A text whose placeholders include one with no value for this certificate (e.g. {final_grade} for a course without
quizzes, {expiry_date} for a certificate that never expires) is left out, so "Valid until {expiry_date}" never
prints half-empty.
"""
import copy
import io
import re
from pathlib import Path

import qrcode
from django.conf import settings
from PIL import Image, ImageDraw, ImageFont, ImageOps

DESIGN_WIDTH = 1000
PAGE_PX = {"LANDSCAPE": (2480, 1754), "PORTRAIT": (1754, 2480)}  # A4 at 300 DPI
LINE_HEIGHT = 1.2
MAX_ELEMENTS = 40
MAX_TEXT = 500
MAX_UPLOAD_BYTES = 15 * 1024 * 1024
ELEMENT_TYPES = ("text", "logo", "signature", "qr", "line", "rect")
FONTS = ("sans", "serif")
ALIGNS = ("left", "center", "right")
PLACEHOLDERS = (
    "learner_name", "course_title", "trainer_name", "issue_date", "certificate_code", "verify_url", "lessons",
    "course_hours", "final_grade", "completion_date", "expiry_date",
)
_COLOR = re.compile(r"^#[0-9a-fA-F]{6}$")
_PLACEHOLDER = re.compile(r"\{(" + "|".join(PLACEHOLDERS) + r")\}")

_FONT_FILES = {
    ("sans", False): ["DejaVuSans.ttf", "arial.ttf", "segoeui.ttf"],
    ("sans", True): ["DejaVuSans-Bold.ttf", "arialbd.ttf", "segoeuib.ttf"],
    ("serif", False): ["DejaVuSerif.ttf", "georgia.ttf", "times.ttf"],
    ("serif", True): ["DejaVuSerif-Bold.ttf", "georgiab.ttf", "timesbd.ttf"],
}
_FONT_DIRS = [Path("/usr/share/fonts/truetype/dejavu"), Path("/usr/share/fonts/dejavu"), Path("C:/Windows/Fonts")]
DEFAULT_LOGO = Path(__file__).resolve().parent / "assets" / "logo.png"


def design_height(orientation: str) -> int:
    return 1414 if orientation == "PORTRAIT" else 707


def _font(family: str, bold: bool, size: float):
    size = max(int(round(size)), 6)
    for directory in _FONT_DIRS:
        for name in _FONT_FILES[(family, bold)]:
            path = directory / name
            if path.exists():
                return ImageFont.truetype(str(path), size)
    return ImageFont.load_default(size=size)


# ---------------------------------------------------------------- the built-in design

def _text(key, text, text_fr, y, size, *, x=100, w=800, color="#64748B", font="sans", bold=False, align="center", single_line=True):
    return {"id": key, "type": "text", "x": x, "y": y, "w": w, "text": text, "text_fr": text_fr, "size": size,
            "color": color, "font": font, "bold": bold, "align": align, "single_line": single_line}


DEFAULT_LAYOUT = [
    {"id": "frame-outer", "type": "rect", "x": 24, "y": 24, "w": 952, "h": 659, "thickness": 5.6, "color": "#C9A227"},
    {"id": "frame-inner", "type": "rect", "x": 40, "y": 40, "w": 920, "h": 627, "thickness": 1.6, "color": "#C9A227"},
    {"id": "logo", "type": "logo", "x": 460, "y": 72, "w": 80},
    _text("heading", "CERTIFICATE OF COMPLETION", "CERTIFICAT DE RÉUSSITE", 178, 24, color="#C9A227", bold=True),
    _text("presented", "This certifies that", "Nous certifions que", 233, 17.7),
    _text("learner", "{learner_name}", "", 266, 60, color="#1B2A4A", font="serif", bold=True),
    _text("completed", "has successfully completed", "a terminé avec succès", 354, 17.7),
    _text("course", "{course_title}", "", 392, 38.7, color="#0F172A", font="serif", bold=True),
    _text("lessons", "{lessons}", "", 440, 15.3),
    _text("hours", "Duration: {course_hours}", "Durée : {course_hours}", 461, 13.7),
    _text("grade", "Final grade: {final_grade}", "Note finale : {final_grade}", 480, 13.7, color="#0F172A", bold=True),
    {"id": "line-trainer", "type": "line", "x": 137, "y": 518, "w": 274, "thickness": 1.6, "color": "#CBD5E1"},
    _text("trainer", "{trainer_name}", "", 527, 18.5, x=137, w=274, color="#0F172A", bold=True),
    _text("trainer-caption", "Delivered by", "Formation assurée par", 556, 13.7, x=137, w=274),
    {"id": "line-date", "type": "line", "x": 589, "y": 518, "w": 274, "thickness": 1.6, "color": "#CBD5E1"},
    _text("date", "{issue_date}", "", 527, 18.5, x=589, w=274, color="#0F172A", bold=True),
    _text("date-caption", "Date issued", "Date de délivrance", 556, 13.7, x=589, w=274),
    _text("expiry", "Valid until {expiry_date}", "Valide jusqu'au {expiry_date}", 575, 12.1, x=589, w=274, color="#B45309"),
    {"id": "qr", "type": "qr", "x": 454, "y": 528, "w": 92, "color": "#000000"},
    _text("code", "Certificate ID {certificate_code} · verify at", "Identifiant {certificate_code} · vérification sur", 630, 12.1),
    _text("url", "{verify_url}", "", 646, 12.1, color="#1B2A4A"),
]
DEFAULT_BACKGROUND = "#FFFDF7"


def default_layout() -> list:
    return copy.deepcopy(DEFAULT_LAYOUT)


# ---------------------------------------------------------------- validation

class TemplateError(ValueError):
    pass


def _number(element, key, default, low, high):
    try:
        value = float(element.get(key, default))
    except (TypeError, ValueError):
        raise TemplateError(f"'{key}' must be a number.")
    if value != value:  # NaN
        raise TemplateError(f"'{key}' must be a number.")
    return round(min(max(value, low), high), 2)


def _color(element, key, default):
    value = str(element.get(key, default) or default)
    if not _COLOR.match(value):
        raise TemplateError(f"'{value}' is not a colour like #1B2A4A.")
    return value.upper()


def clean_color(value) -> str:
    return _color({"c": value}, "c", "#FFFFFF")


def clean_layout(layout, orientation: str = "LANDSCAPE") -> list:
    """The layout as sent by the designer, checked and normalised (unknown keys dropped, numbers clamped to the page)."""
    if not isinstance(layout, list):
        raise TemplateError("The layout must be a list of elements.")
    if len(layout) > MAX_ELEMENTS:
        raise TemplateError(f"A certificate can have at most {MAX_ELEMENTS} elements.")
    height = design_height(orientation)
    cleaned, seen = [], set()
    for index, element in enumerate(layout):
        if not isinstance(element, dict) or element.get("type") not in ELEMENT_TYPES:
            raise TemplateError("Unknown element type.")
        kind = element["type"]
        element_id = str(element.get("id") or f"{kind}-{index}")[:40]
        if element_id in seen:
            element_id = f"{element_id}-{index}"
        seen.add(element_id)
        item = {
            "id": element_id, "type": kind,
            "x": _number(element, "x", 0, -DESIGN_WIDTH, DESIGN_WIDTH),
            "y": _number(element, "y", 0, -height, height),
            "w": _number(element, "w", 100, 1, DESIGN_WIDTH * 2),
        }
        if kind == "text":
            text = str(element.get("text", ""))[:MAX_TEXT]
            text_fr = str(element.get("text_fr", "") or "")[:MAX_TEXT]
            font = element.get("font", "sans")
            align = element.get("align", "center")
            if font not in FONTS:
                raise TemplateError(f"Unknown font '{font}'.")
            if align not in ALIGNS:
                raise TemplateError(f"Unknown alignment '{align}'.")
            item.update({
                "text": text, "text_fr": text_fr, "font": font, "align": align,
                "bold": bool(element.get("bold", False)), "single_line": bool(element.get("single_line", True)),
                "size": _number(element, "size", 18, 4, 200), "color": _color(element, "color", "#0F172A"),
            })
        elif kind == "qr":
            item["color"] = _color(element, "color", "#000000")
        elif kind == "line":
            item.update({"thickness": _number(element, "thickness", 1.5, 0.2, 40), "color": _color(element, "color", "#CBD5E1")})
        elif kind == "rect":
            item.update({
                "h": _number(element, "h", 100, 1, height * 2),
                "thickness": _number(element, "thickness", 2, 0.2, 60), "color": _color(element, "color", "#C9A227"),
            })
        cleaned.append(item)
    return cleaned


# ---------------------------------------------------------------- uploads

def background_from_upload(upload) -> tuple[bytes, str]:
    """An uploaded blank certificate (PDF — first page — or an image) as PNG bytes, plus the orientation it implies."""
    if upload.size > MAX_UPLOAD_BYTES:
        raise TemplateError("The file is too large (15 MB maximum).")
    data = upload.read()
    if data[:5] == b"%PDF-":
        import pypdfium2

        try:
            document = pypdfium2.PdfDocument(data)
            page = document[0]
            width, height = page.get_size()
            scale = min(3508 / max(width, height), 300 / 72)  # about 300 DPI on A4, capped at the A4 long side
            image = page.render(scale=scale).to_pil().convert("RGB")
            document.close()
        except Exception:
            raise TemplateError("This PDF could not be read. Export it again or upload it as a PNG or JPG image.")
    else:
        try:
            image = Image.open(io.BytesIO(data))
            image.load()
            image = ImageOps.exif_transpose(image).convert("RGB")
        except Exception:
            raise TemplateError("Upload the blank certificate as a PDF, PNG or JPG file.")
    buffer = io.BytesIO()
    image.save(buffer, format="PNG", optimize=True)
    return buffer.getvalue(), ("PORTRAIT" if image.height > image.width else "LANDSCAPE")


def logo_from_upload(upload) -> bytes:
    if upload.size > MAX_UPLOAD_BYTES:
        raise TemplateError("The file is too large (15 MB maximum).")
    try:
        image = Image.open(upload)
        image.load()
        image = ImageOps.exif_transpose(image).convert("RGBA")
    except Exception:
        raise TemplateError("Upload the logo as a PNG (ideally with a transparent background) or JPG image.")
    image.thumbnail((1200, 1200))
    buffer = io.BytesIO()
    image.save(buffer, format="PNG", optimize=True)
    return buffer.getvalue()


def signature_from_upload(upload) -> bytes:
    """A signature (drawn in the designer or uploaded) as a PNG trimmed to the ink. The background should already be
    transparent: an opaque background is kept as is (the designer tells admins to remove it before uploading)."""
    if upload.size > MAX_UPLOAD_BYTES:
        raise TemplateError("The file is too large (15 MB maximum).")
    try:
        image = Image.open(upload)
        image.load()
        image = ImageOps.exif_transpose(image).convert("RGBA")
    except Exception:
        raise TemplateError("Upload the signature as a PNG (with a transparent background) or JPG image.")
    box = image.getchannel("A").point(lambda alpha: 255 if alpha > 8 else 0).getbbox()
    if box is None:
        raise TemplateError("The signature is empty.")
    image = image.crop(box)
    image.thumbnail((1600, 800))
    buffer = io.BytesIO()
    image.save(buffer, format="PNG", optimize=True)
    return buffer.getvalue()


# ---------------------------------------------------------------- rendering

def fill_placeholders(text: str, values: dict) -> str:
    return _PLACEHOLDER.sub(lambda match: str(values.get(match.group(1), "")), text)


def _open_field(field):
    if not field:
        return None
    try:
        field.open("rb")
        try:
            image = Image.open(io.BytesIO(field.read()))
            image.load()
            return image
        finally:
            field.close()
    except Exception:  # a missing or unreadable file must not stop certificates being issued
        return None


def _wrap(draw, text: str, font, width: float) -> list[str]:
    lines = []
    for paragraph in text.split("\n"):
        current = ""
        for word in paragraph.split(" "):
            candidate = f"{current} {word}" if current else word
            if current and draw.textlength(candidate, font=font) > width:
                lines.append(current)
                current = word
            else:
                current = candidate
        lines.append(current)
    return lines


def _draw_text(draw, element, text, scale):
    family, bold = element["font"], element["bold"]
    size = element["size"] * scale
    box_x, box_w = element["x"] * scale, element["w"] * scale
    font = _font(family, bold, size)
    if element["single_line"]:
        text = " ".join(text.split())
        while size > 8 and draw.textlength(text, font=font) > box_w:
            size *= 0.94
            font = _font(family, bold, size)
        lines = [text]
    else:
        lines = _wrap(draw, text, font, box_w)
    anchor_x = {"left": box_x, "center": box_x + box_w / 2, "right": box_x + box_w}[element["align"]]
    anchor = {"left": "lm", "center": "mm", "right": "rm"}[element["align"]]
    line_box = size * LINE_HEIGHT
    top = element["y"] * scale
    for index, line in enumerate(lines):
        draw.text((anchor_x, top + line_box * (index + 0.5)), line, font=font, fill=element["color"], anchor=anchor)


def render(template, values: dict, locale: str = "en") -> Image.Image:
    """Draws a certificate. template is a CertificateTemplate, or None for the built-in design; values holds the
    PLACEHOLDERS for this certificate (verify_url is also what the QR code encodes)."""
    orientation = template.orientation if template else "LANDSCAPE"
    layout = template.layout if template else DEFAULT_LAYOUT
    width, height = PAGE_PX[orientation]
    scale = width / DESIGN_WIDTH

    image = Image.new("RGB", (width, height), template.background_color if template else DEFAULT_BACKGROUND)
    background = _open_field(template.background_image) if template else None
    if background is not None:
        image.paste(ImageOps.fit(background.convert("RGB"), (width, height), Image.Resampling.LANCZOS), (0, 0))
    draw = ImageDraw.Draw(image)

    logo = None
    signature = _open_field(getattr(template, "signature", None))
    signature = signature.convert("RGBA") if signature is not None else None
    for element in layout:
        kind = element["type"]
        x, y, w = element["x"] * scale, element["y"] * scale, element["w"] * scale
        if kind == "text":
            source = element["text_fr"] if locale == "fr" and element.get("text_fr") else element["text"]
            if any(not values.get(key) for key in _PLACEHOLDER.findall(source)):
                continue
            text = fill_placeholders(source, values).strip()
            if text:
                _draw_text(draw, element, text, scale)
        elif kind == "logo":
            if logo is None:
                logo = (_open_field(template.logo) if template else None) or Image.open(DEFAULT_LOGO)
                logo = logo.convert("RGBA")
            target_w = max(int(w), 1)
            resized = logo.resize((target_w, max(int(logo.height * target_w / logo.width), 1)), Image.Resampling.LANCZOS)
            image.paste(resized, (int(x), int(y)), resized)
        elif kind == "signature":
            if signature is not None:
                target_w = max(int(w), 1)
                size = (target_w, max(int(signature.height * target_w / signature.width), 1))
                resized = signature.resize(size, Image.Resampling.LANCZOS)
                image.paste(resized, (int(x), int(y)), resized)
        elif kind == "qr":
            size = max(int(w), 16)
            code = qrcode.QRCode(border=1, box_size=10)
            code.add_data(values.get("verify_url", ""))
            code.make(fit=True)
            qr = code.make_image(fill_color=element["color"], back_color="white").convert("RGB")
            image.paste(qr.resize((size, size), Image.Resampling.NEAREST), (int(x), int(y)))
        elif kind == "line":
            thickness = max(int(round(element["thickness"] * scale)), 1)
            draw.line((x, y, x + w, y), fill=element["color"], width=thickness)
        elif kind == "rect":
            thickness = max(int(round(element["thickness"] * scale)), 1)
            draw.rectangle((x, y, x + w, y + element["h"] * scale), outline=element["color"], width=thickness)
    return image


def to_pdf(image: Image.Image, title: str) -> bytes:
    buffer = io.BytesIO()
    image.save(buffer, format="PDF", resolution=300.0, title=title, author="Oaziland")
    return buffer.getvalue()


def to_png(image: Image.Image, max_width: int = 1600) -> bytes:
    if image.width > max_width:
        image = image.resize((max_width, int(image.height * max_width / image.width)), Image.Resampling.LANCZOS)
    buffer = io.BytesIO()
    image.save(buffer, format="PNG", optimize=True)
    return buffer.getvalue()


def active_template():
    from .models import CertificateTemplate
    return CertificateTemplate.objects.filter(is_active=True).first()


def template_for_program(program):
    """The course's own template, else the platform default (the active template); None means the built-in design."""
    return program.certificate_template or active_template()


# ---------------------------------------------------------------- freezing a design at issue time

def _field_bytes(field):
    if not field:
        return None
    try:
        field.open("rb")
        try:
            return field.read()
        finally:
            field.close()
    except Exception:  # a missing file is frozen as "no file", which is also how render() would draw it
        return None


def freeze_design(template, design_model=None):
    """The CertificateDesign snapshot of template (None = the built-in design) as it is right now, reusing an
    identical existing snapshot. design_model lets data migrations pass their historical model."""
    import hashlib
    import json

    from django.core.files.base import ContentFile
    from django.db import IntegrityError, transaction

    if design_model is None:
        from .models import CertificateDesign as design_model

    if template is None:
        orientation, color, layout = "LANDSCAPE", DEFAULT_BACKGROUND, default_layout()
        background = logo = signature = None
    else:
        orientation, color, layout = template.orientation, template.background_color, copy.deepcopy(template.layout)
        background, logo = _field_bytes(template.background_image), _field_bytes(template.logo)
        signature = _field_bytes(getattr(template, "signature", None))  # historical models in 0014 have none

    digest = hashlib.sha256(json.dumps([orientation, color, layout], sort_keys=True).encode())
    for data in (background, logo):
        digest.update(b"|" + (hashlib.sha256(data).digest() if data else b"-"))
    if signature:  # only when present, so designs frozen before signatures existed keep their fingerprint
        digest.update(b"|signature|" + hashlib.sha256(signature).digest())
    fingerprint = digest.hexdigest()

    existing = design_model.objects.filter(fingerprint=fingerprint).first()
    if existing is not None:
        return existing
    design = design_model(
        fingerprint=fingerprint, source_template_id=getattr(template, "pk", None),
        source_name=template.name if template is not None else "",
        orientation=orientation, background_color=color, layout=layout,
    )
    if background:
        design.background_image.save(f"{fingerprint[:16]}-background.png", ContentFile(background), save=False)
    if logo:
        design.logo.save(f"{fingerprint[:16]}-logo.png", ContentFile(logo), save=False)
    if signature:
        design.signature.save(f"{fingerprint[:16]}-signature.png", ContentFile(signature), save=False)
    try:
        with transaction.atomic():
            design.save()
    except IntegrityError:  # the same design was frozen concurrently
        for field in (design.background_image, design.logo, getattr(design, "signature", None)):
            if field:
                field.delete(save=False)
        return design_model.objects.get(fingerprint=fingerprint)
    return design


def sample_values(locale: str = "en") -> dict:
    """What the designer preview fills the placeholders with."""
    french = locale == "fr"
    return {
        "learner_name": "Amina Nkeng",
        "course_title": "Gestion immobilière : les bases" if french else "Property Management Basics",
        "trainer_name": "Oaziland Academy",
        "issue_date": "11 novembre 2026" if french else "November 11, 2026",
        "certificate_code": "OZL-SAMPLE1234",
        "verify_url": f"{settings.WEB_BASE_URL}/{'fr' if french else 'en'}/certificates/OZL-SAMPLE1234",
        "lessons": "12 leçons" if french else "12 lessons",
        "course_hours": "8 heures" if french else "8 hours",
        "final_grade": "92 %" if french else "92%",
        "completion_date": "10 novembre 2026" if french else "November 10, 2026",
        "expiry_date": "11 novembre 2028" if french else "November 11, 2028",
    }
