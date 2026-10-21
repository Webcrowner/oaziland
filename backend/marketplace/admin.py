from django.contrib import admin

from .models import MarketplaceOrder


@admin.register(MarketplaceOrder)
class MarketplaceOrderAdmin(admin.ModelAdmin):
    list_display = ("id", "listing", "buyer", "amount_xaf", "status", "created_at")
    list_filter = ("status",)
    search_fields = ("id", "buyer__username", "listing__title")
    readonly_fields = ("created_at", "handed_over_at", "completed_at")
