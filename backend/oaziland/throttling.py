from rest_framework.throttling import UserRateThrottle


class RoleAwareUserRateThrottle(UserRateThrottle):
    """The default per-user budget, except that admins draw on the larger
    "admin" budget. One admin-console load makes about 15 requests, every
    action reloads it, and SOS polling adds 4 a minute — the ordinary
    300/hour ran out mid-shift and locked the admin out of the console."""

    def allow_request(self, request, view):
        user = getattr(request, "user", None)
        if user and user.is_authenticated and hasattr(user, "admin_profile"):
            self.scope = "admin"
            self.rate = self.get_rate()
            self.num_requests, self.duration = self.parse_rate(self.rate)
        return super().allow_request(request, view)
