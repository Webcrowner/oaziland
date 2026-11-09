from django.contrib.admin.apps import AdminConfig


class OaziAdminConfig(AdminConfig):
    """Django admin using Oaziland's site: no login of its own (see oaziland/admin_site.py)."""
    default_site = "oaziland.admin_site.OaziAdminSite"
