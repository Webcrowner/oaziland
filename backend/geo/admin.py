from django.contrib import admin

from oaziland.admin_base import OaziAdmin, register

from .models import AreaSuggestion, Country, Division, PointOfInterest, Quarter, Region, Subdivision, VillageOrDistrict
from .services import AreaSuggestionError, approve_area_suggestion, reject_area_suggestion

# Reference data: editable, and deletable (anything still in use is protected by the database).
register(Country, list_display=("name", "iso_code"), search_fields=("name", "iso_code"), allow_delete=True)
register(Region, list_display=("name", "country"), list_filter=("country",), search_fields=("name",), allow_delete=True)
register(Division, list_display=("name", "region"), list_filter=("region",), search_fields=("name",), allow_delete=True)
register(Subdivision, list_display=("name", "division__name"), search_fields=("name", "division__name"), allow_delete=True)
register(VillageOrDistrict, list_display=("name", "subdivision__name"), search_fields=("name", "subdivision__name"), allow_delete=True)
register(Quarter, list_display=("name", "village_or_district__name"), search_fields=("name", "village_or_district__name"),
         ordering=("name",), allow_delete=True)
register(PointOfInterest, list_display=("name", "poi_type", "quarter"), list_filter=("poi_type",),
         search_fields=("name", "quarter__name"), allow_delete=True)


@admin.register(AreaSuggestion)
class AreaSuggestionAdmin(OaziAdmin):
    list_display = ("area_name", "city_name", "region", "status", "suggested_by", "created_at")
    list_filter = ("status", "region")
    actions = ["approve_suggestions", "reject_suggestions"]

    @staticmethod
    def _reviewer(request):
        user = getattr(request, "user", None)
        return user if getattr(user, "pk", None) else None

    @admin.action(description="Approve selected — create the neighbourhood")
    def approve_suggestions(self, request, queryset):
        for suggestion in queryset.filter(status="PENDING"):
            try:
                approve_area_suggestion(suggestion, admin=self._reviewer(request))
            except AreaSuggestionError:
                continue

    @admin.action(description="Reject selected")
    def reject_suggestions(self, request, queryset):
        for suggestion in queryset.filter(status="PENDING"):
            try:
                reject_area_suggestion(suggestion, admin=self._reviewer(request), reason="Declined by the Oaziland team.")
            except AreaSuggestionError:
                continue
