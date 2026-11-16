"""
Management command: generate_vapid_keys — prints a new VAPID key pair for Web Push.
Put the two values in the backend environment (backend/.env locally, the host's secret settings in production)
as VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY, plus VAPID_SUBJECT (e.g. mailto:support@oaziland.com).
Generate once per environment and keep it: changing the keys invalidates every browser's existing subscription.
"""
import base64

from django.core.management.base import BaseCommand


def _b64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


class Command(BaseCommand):
    help = "Prints a new VAPID key pair for Web Push notifications."

    def handle(self, *args, **options):
        from cryptography.hazmat.primitives import serialization
        from cryptography.hazmat.primitives.asymmetric import ec

        private_key = ec.generate_private_key(ec.SECP256R1())
        private_raw = private_key.private_numbers().private_value.to_bytes(32, "big")
        public_raw = private_key.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
        self.stdout.write(f"VAPID_PUBLIC_KEY={_b64url(public_raw)}")
        self.stdout.write(f"VAPID_PRIVATE_KEY={_b64url(private_raw)}")
        self.stdout.write("VAPID_SUBJECT=mailto:support@oaziland.com")
        self.stderr.write("Keep VAPID_PRIVATE_KEY secret: never commit it.")
