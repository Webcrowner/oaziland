"""
notifications — the shared NotificationChannel used across every module
(WhatsApp, push, email) per Architecture doc §7.4. Not yet implemented
as a model; will likely be a service class + a lightweight delivery-log
table rather than a heavy model.
"""
