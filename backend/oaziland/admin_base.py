"""
oaziland.admin_base — the rules every Django admin page (/admin/) on Oaziland follows.

- Only full-access administrators (identity.services.is_super_admin) see or touch anything; Django's own
  per-model permission flags and is_staff are not used. There is no login here: admins sign in on the
  website's admin console, which hands them over (oaziland/admin_site.py).
- read_only pages (money, audit trails, moderation history) can be looked at but never added to, edited
  or deleted — those records only change through the services that own them.
- Deleting is off unless a page opts in (reference data), because most records cascade into others.
- hidden_fields are never shown; masked_fields show only their last characters (ID numbers, phone numbers).
- Every add, change, delete and bulk action is written to the same AuditLog as the admin console, with the
  names of the changed fields but never their values.
- Foreign keys use plain id inputs instead of dropdowns, and lists skip the full row count, so pages stay
  fast on large tables.
"""
import logging

from django.contrib import admin
from django.contrib.admin import helpers

from oaziland.admin_site import can_use_admin

logger = logging.getLogger(__name__)


def mask(value, keep: int = 4) -> str:
    text = str(value or "")
    if not text:
        return "-"
    return "\u2022" * max(len(text) - keep, 3) + text[-keep:] if len(text) > keep else "\u2022" * len(text)


def _changed_fields(message) -> list[str]:
    fields = []
    for entry in message if isinstance(message, list) else []:
        for verb in ("changed", "added"):
            fields.extend((entry.get(verb) or {}).get("fields", []) if isinstance(entry, dict) else [])
    return sorted({str(name) for name in fields})


class OaziAdmin(admin.ModelAdmin):
    read_only = False
    allow_delete = False
    hidden_fields: tuple = ()
    masked_fields: tuple = ()
    list_per_page = 50
    show_full_result_count = False

    def __init__(self, model, admin_site):
        own = type(self).__dict__
        fields = [f for f in model._meta.concrete_fields if not (f.one_to_one and f.remote_field.parent_link)]
        if "raw_id_fields" not in own:
            self.raw_id_fields = tuple(
                f.name for f in fields if f.is_relation and f.editable and f.name not in self.hidden_fields + self.masked_fields
            )
        if "ordering" not in own and any(f.name == "created_at" for f in fields):
            self.ordering = ("-created_at",)
        automatic = tuple(f.name for f in fields if not f.editable and f.name not in self.hidden_fields + self.masked_fields)
        self.readonly_fields = tuple(dict.fromkeys(tuple(own.get("readonly_fields", ())) + automatic))
        for name in self.masked_fields:
            self.readonly_fields += (self._masked_display(name),)
        super().__init__(model, admin_site)

    @staticmethod
    def _masked_display(name):
        @admin.display(description=f"{name.replace('_', ' ')} (masked)")
        def display(obj):
            return mask(getattr(obj, name, ""))
        display.__name__ = f"masked_{name}"
        return display

    def get_exclude(self, request, obj=None):
        return tuple(super().get_exclude(request, obj) or ()) + tuple(self.hidden_fields) + tuple(self.masked_fields)

    # Access ---------------------------------------------------------------
    def has_module_permission(self, request):
        return can_use_admin(request)

    def has_view_permission(self, request, obj=None):
        return can_use_admin(request)

    def has_add_permission(self, request):
        return can_use_admin(request) and not self.read_only

    def has_change_permission(self, request, obj=None):
        return can_use_admin(request) and not self.read_only

    def has_delete_permission(self, request, obj=None):
        return can_use_admin(request) and self.allow_delete and not self.read_only

    # Audit ----------------------------------------------------------------
    def _audit(self, request, verb: str, obj=None, details=None):
        try:
            from trust_safety.audit import _client_ip
            from trust_safety.models import AuditLog

            opts = self.model._meta
            AuditLog.objects.create(
                actor=request.user, actor_username=request.user.username,
                action=f"django-admin/{opts.model_name}/{verb}"[:120], target_type=opts.label_lower[:60],
                target_id=str(getattr(obj, "pk", "") or "")[:64], target_label=(str(obj) if obj is not None else "")[:200],
                details=details or {}, status_code=200, ip_address=_client_ip(request),
            )
        except Exception:
            logger.exception("Could not write the Django admin audit entry")

    def log_addition(self, request, obj, message):
        entry = super().log_addition(request, obj, message)
        self._audit(request, "add", obj)
        return entry

    def log_change(self, request, obj, message):
        entry = super().log_change(request, obj, message)
        self._audit(request, "change", obj, {"fields": _changed_fields(message)})
        return entry

    def log_deletions(self, request, queryset):
        entries = super().log_deletions(request, queryset)
        for obj in queryset:
            self._audit(request, "delete", obj)
        return entries

    def response_action(self, request, queryset):
        action = request.POST.get("action", "")
        selected = request.POST.getlist(helpers.ACTION_CHECKBOX_NAME)
        response = super().response_action(request, queryset)
        if action and action != "delete_selected" and selected:
            self._audit(request, f"action:{action}", details={"count": len(selected)})
        return response


def register(model, *, base=OaziAdmin, **options):
    """Registers model with an OaziAdmin subclass built from the given options."""
    admin_class = type(f"{model.__name__}Admin", (base,), {"__module__": model.__module__, **options})
    admin.site.register(model, admin_class)
    return admin_class


__all__ = ["OaziAdmin", "can_use_admin", "mask", "register"]
