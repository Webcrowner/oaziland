from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("marketplace", "0011_driverprofile_location"),
    ]

    operations = [
        migrations.AlterField(
            model_name="marketplaceorder",
            name="status",
            field=models.CharField(
                choices=[
                    ("PAYMENT_PENDING", "Payment pending"),
                    ("PAID", "Paid into escrow"),
                    ("HANDED_OVER", "Handed over"),
                    ("COMPLETED", "Completed"),
                    ("CANCELLED", "Cancelled"),
                    ("DISPUTED", "Disputed"),
                ],
                default="PAYMENT_PENDING",
                max_length=15,
            ),
        ),
    ]
