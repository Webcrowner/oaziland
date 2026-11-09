"""
visitors — anonymous website analytics for the admin console.

One VisitorEvent row per page view. Nothing here identifies a person: there are
no cookies, no user ids and no stored IP addresses. `visitor_hash` is a keyed
hash of (day, IP, browser string) whose key changes every day, so it can count
distinct visitors within a day but cannot follow anyone from one day to the next.
"""
from django.db import models
from django.utils import timezone


class VisitorEvent(models.Model):
    created_at = models.DateTimeField(default=timezone.now)
    visitor_hash = models.CharField(max_length=32)
    path = models.CharField(max_length=200)
    locale = models.CharField(max_length=5, blank=True)
    referrer_host = models.CharField(max_length=100, blank=True)
    country_code = models.CharField(max_length=2, blank=True)
    region = models.CharField(max_length=100, blank=True)
    city = models.CharField(max_length=100, blank=True)
    device_type = models.CharField(max_length=10, blank=True)
    os = models.CharField(max_length=30, blank=True)
    browser = models.CharField(max_length=30, blank=True)
    timezone = models.CharField(max_length=64, blank=True)
    screen_width = models.PositiveSmallIntegerField(null=True, blank=True)
    is_signed_in = models.BooleanField(default=False)

    class Meta:
        db_table = "visitor_events"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["-created_at"]),
            models.Index(fields=["country_code", "-created_at"]),
            models.Index(fields=["visitor_hash", "-created_at"]),
        ]

    def __str__(self):
        return f"{self.created_at:%Y-%m-%d %H:%M} {self.country_code or '??'} {self.path}"
