from django.db import migrations, models


def backfill_review_dates(apps, schema_editor):
    # ID checks marked verified or rejected outside the review screen (seed data, scripts) never got a review
    # date, so analytics counted none of them as approved. Use the submission time as the best known date.
    KYCProfile = apps.get_model("identity", "KYCProfile")
    KYCProfile.objects.filter(kyc_status__in=["VERIFIED", "REJECTED"], reviewed_at__isnull=True).update(
        reviewed_at=models.F("submitted_at"),
    )


class Migration(migrations.Migration):

    dependencies = [
        ("identity", "0012_technician_review_fields"),
    ]

    operations = [
        migrations.RunPython(backfill_review_dates, migrations.RunPython.noop),
    ]
