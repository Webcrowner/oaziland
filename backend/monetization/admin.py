from django.contrib import admin

from .models import PlatformFeePolicy


@admin.register(PlatformFeePolicy)
class PlatformFeePolicyAdmin(admin.ModelAdmin):
    """The real gap this closes: PlatformFeePolicy previously had no
    admin UI at all — the only way to create or change a fee row was a
    raw Django shell command."""
    list_display = ["category", "fee_percent"]
