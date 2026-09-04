"""
flyers.services — resolves what a flyer's QR code should point to, and
composes the actual printable image (logo + headline + details + QR)
using qrcode and Pillow.
"""
import io
import qrcode
from PIL import Image, ImageDraw, ImageFont
from django.core.files.base import ContentFile

BASE_URL = "https://oaziland.com"


def resolve_qr_target_url(*, qr_target_type: str, qr_target_id=None, quarter_id=None, category: str = None) -> str:
    """The ONE place that decides what URL a flyer's QR code encodes —
    centralizing this means the URL scheme can change later without
    hunting through every place a flyer gets generated."""
    from .models import QrTargetType

    if qr_target_type == QrTargetType.SINGLE_LISTING:
        return f"{BASE_URL}/listing/{qr_target_id}"
    if qr_target_type == QrTargetType.AGENT_PROFILE:
        return f"{BASE_URL}/agent/{qr_target_id}"
    if qr_target_type == QrTargetType.AGENCY_PROFILE:
        return f"{BASE_URL}/agency/{qr_target_id}"
    if qr_target_type == QrTargetType.QUARTER_SEARCH:
        return f"{BASE_URL}/search?quarter={quarter_id}&category={category}"
    raise ValueError(f"Unknown qr_target_type: {qr_target_type}")


def _generate_qr_image(data: str) -> Image.Image:
    qr = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_M, box_size=8, border=2)
    qr.add_data(data)
    qr.make(fit=True)
    return qr.make_image(fill_color="black", back_color="white").convert("RGB")


def _compose_flyer_image(*, category_label: str, finish_label: str, details: str, company_name: str, logo_url: str, qr_image: Image.Image) -> Image.Image:
    """Composes the actual printable flyer — a simple, high-contrast
    layout deliberately optimized for being printed cheaply and read
    from a distance on a wall, not a polished marketing design."""
    width, height = 800, 1000
    canvas = Image.new("RGB", (width, height), "white")
    draw = ImageDraw.Draw(canvas)

    try:
        headline_font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 56)
        body_font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 32)
        small_font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 24)
    except OSError:
        headline_font = body_font = small_font = ImageFont.load_default()

    draw.rectangle([0, 0, width, 100], fill="#1B2A4A")
    draw.text((40, 30), company_name.upper(), fill="white", font=body_font)

    draw.text((40, 140), category_label.upper(), fill="#1B2A4A", font=headline_font)
    y = 220
    if finish_label:
        draw.text((40, y), finish_label, fill="#333333", font=body_font)
        y += 50
    if details:
        draw.text((40, y), details, fill="#333333", font=body_font)

    qr_size = 350
    qr_resized = qr_image.resize((qr_size, qr_size))
    canvas.paste(qr_resized, ((width - qr_size) // 2, height - qr_size - 100))
    draw.text((width // 2 - 140, height - 80), "SCAN TO VIEW ON OAZILAND", fill="#1B2A4A", font=small_font)

    return canvas


def generate_flyer(*, created_by, category: str, finish_level: str = "", headline_details: str = "",
                    company_name: str = "Oaziland", logo_url: str = "",
                    qr_target_type: str, qr_target_id=None, quarter_id=None):
    """The full flow: resolve the QR target URL, render a real QR code,
    compose the full flyer image, and save it as a real file — a
    landlord/agent/agency/technician can download and print the result."""
    from .models import Flyer, FlyerCategory, FinishLevel

    qr_url = resolve_qr_target_url(qr_target_type=qr_target_type, qr_target_id=qr_target_id, quarter_id=quarter_id, category=category)
    qr_image = _generate_qr_image(qr_url)

    category_label = FlyerCategory(category).label
    finish_label = FinishLevel(finish_level).label if finish_level else ""

    flyer_image = _compose_flyer_image(
        category_label=category_label, finish_label=finish_label, details=headline_details,
        company_name=company_name, logo_url=logo_url, qr_image=qr_image,
    )

    buffer = io.BytesIO()
    flyer_image.save(buffer, format="PNG")
    buffer.seek(0)

    flyer = Flyer(
        created_by=created_by, category=category, finish_level=finish_level,
        headline_details=headline_details, company_name=company_name, logo_url=logo_url,
        qr_target_type=qr_target_type, qr_target_id=qr_target_id, qr_target_url=qr_url,
    )
    flyer.generated_image.save(f"flyer_{category}.png", ContentFile(buffer.read()), save=False)
    flyer.save()

    return flyer
