from django.contrib import admin

from .models import (
    AreaSuggestion, AreaSuggestionStatus, Division, Quarter, Subdivision, VillageOrDistrict,
)


@admin.register(AreaSuggestion)
class AreaSuggestionAdmin(admin.ModelAdmin):
    list_display = ("area_name", "city_name", "region", "status", "suggested_by", "created_at")
    list_filter = ("status", "region")
    actions = ["approve_suggestions", "reject_suggestions"]

    @admin.action(description="Approve selected — create the neighbourhood")
    def approve_suggestions(self, request, queryset):
        for suggestion in queryset.filter(status=AreaSuggestionStatus.PENDING):
            district = VillageOrDistrict.objects.filter(
                name__iexact=suggestion.city_name, subdivision__division__region=suggestion.region,
            ).first()
            if district is None:
                division, _ = Division.objects.get_or_create(region=suggestion.region, name="Other")
                subdivision, _ = Subdivision.objects.get_or_create(division=division, name=suggestion.city_name)
                district, _ = VillageOrDistrict.objects.get_or_create(subdivision=subdivision, name=suggestion.city_name)
            quarter, _ = Quarter.objects.get_or_create(village_or_district=district, name=suggestion.area_name)
            suggestion.created_quarter = quarter
            suggestion.status = AreaSuggestionStatus.APPROVED
            suggestion.save(update_fields=["created_quarter", "status"])

    @admin.action(description="Reject selected")
    def reject_suggestions(self, request, queryset):
        queryset.filter(status=AreaSuggestionStatus.PENDING).update(status=AreaSuggestionStatus.REJECTED)
