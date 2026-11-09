"""Closes a data leak: exports used to be saved as media/data_exports/export_<user id>.json, which is publicly
served, and user ids are public. Every such file is deleted and its request marked expired; the user can
simply ask for a new export, which now goes to private storage under a random name."""
from pathlib import Path

from django.conf import settings
from django.db import migrations


def remove_public_exports(apps, schema_editor):
    DataExportRequest = apps.get_model("compliance", "DataExportRequest")
    public_dir = Path(settings.MEDIA_ROOT) / "data_exports"

    for request in DataExportRequest.objects.exclude(export_file=""):
        name = str(request.export_file or "")
        if name.startswith("data_exports/export_"):
            request.export_file = ""
            request.status = "EXPIRED"
            request.save(update_fields=["export_file", "status"])

    if public_dir.is_dir():
        for path in public_dir.glob("export_*.json"):
            path.unlink(missing_ok=True)
        try:
            public_dir.rmdir()
        except OSError:
            pass  # something else lives there; leave the folder


class Migration(migrations.Migration):

    dependencies = [
        ("compliance", "0003_dataexportrequest_downloaded_at_and_more"),
    ]

    operations = [
        migrations.RunPython(remove_public_exports, migrations.RunPython.noop),
    ]
