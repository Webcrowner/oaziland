from django.core.checks import Warning, register


@register()
def warn_about_sandbox_notification_channels(app_configs, **kwargs):
    """Shown by runserver, migrate and `manage.py check`: names the channels that look like they work but send nothing."""
    from .services import sandbox_channels

    channels = sandbox_channels()
    if not channels:
        return []
    return [
        Warning(
            f"{', '.join(channels)} notifications are NOT being delivered: these channels still use the sandbox stand-in.",
            hint=(
                "Messages are saved but never sent, including SMS to a user's emergency contact when they press SOS on an "
                "OaziGo ride. Configure the required provider environment variables for each channel; see "
                "backend/.env.example. PUSH intentionally remains sandboxed until a push provider is selected."
            ),
            id="notifications.W001",
        )
    ]
