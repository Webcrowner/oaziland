"""
social — the engagement layer: posts, follows, reviews, comments, ratings,
sharing, referrals, groups, messaging, favorites, and automated life-event
greetings. Built per Prompt 7 / UML Sections 7 and 11.

Design note: every "who did what to what" relationship here is its own
small class (Follow, Favorite, ShareEvent...) rather than one giant
generic "Activity" table. This costs a few more tables, but it means each
kind of interaction can carry exactly the fields it needs (a ShareEvent
needs a channel; a Follow doesn't) and each has a clear, honest name.
"""
import uuid
from django.conf import settings
from django.db import models


class ContentStatus(models.TextChoices):
    """Shared by both Post and Listing (see property/models.py) so a
    'draft vs scheduled vs published' item behaves the same way everywhere
    in the platform, not slightly differently per feature."""
    DRAFT = "DRAFT", "Draft"
    SCHEDULED = "SCHEDULED", "Scheduled"
    PENDING_REVIEW = "PENDING_REVIEW", "Pending Review"
    PUBLISHED = "PUBLISHED", "Published"
    CLOSED = "CLOSED", "Closed"


class PosterRole(models.TextChoices):
    LANDLORD = "LANDLORD", "Landlord"
    INDEPENDENT_AGENT = "INDEPENDENT_AGENT", "Independent Agent"
    AGENCY_AGENT = "AGENCY_AGENT", "Agency Agent"


class PostType(models.TextChoices):
    """WHY a field on Post rather than separate Reel/Story/Status models:
    they share every other field (author, media, caption, attribution) —
    only their LIFESPAN differs (a Story/Status expires; a standard post
    or Reel doesn't). One model with a type flag plus an expiry field
    captures that difference without duplicating everything else."""
    STANDARD = "STANDARD", "Standard Post"
    REEL = "REEL", "Reel"
    STORY = "STORY", "Story"
    STATUS = "STATUS", "Status"


class Tag(models.Model):
    """A hashtag-style keyword — 'just like TikTok'. Kept as its own
    table (not a comma-separated string field) so the recommendation
    engine can efficiently find 'other posts with this same tag'."""
    name = models.CharField(max_length=50, unique=True)

    class Meta:
        db_table = "tags"

    def __str__(self):
        return f"#{self.name}"


class Post(models.Model):
    """A social post — a photo/video/audio update, optionally linked to a
    property listing. Every post must declare who posted it and from
    where/when (PosterAttribution below) — this is a platform-wide trust
    requirement, not optional metadata."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    author = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="posts",
    )
    post_type = models.CharField(max_length=10, choices=PostType.choices, default=PostType.STANDARD)
    caption = models.TextField(blank=True)
    tags = models.ManyToManyField(Tag, blank=True, related_name="posts")
    linked_listing_id = models.UUIDField(null=True, blank=True)
    status = models.CharField(max_length=20, choices=ContentStatus.choices, default=ContentStatus.DRAFT)
    scheduled_publish_at = models.DateTimeField(null=True, blank=True)
    published_at = models.DateTimeField(null=True, blank=True)
    expires_at = models.DateTimeField(null=True, blank=True)  # set for STORY/STATUS only
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "posts"
        indexes = [models.Index(fields=["status", "scheduled_publish_at"])]

    def publish(self):
        """Moves a draft or scheduled post live. Kept as a method (not just
        a status = PUBLISHED assignment somewhere else) so publishing
        always sets published_at consistently, in one place. Stories and
        Statuses also get a 24-hour expiry set automatically here."""
        from django.utils import timezone
        self.status = ContentStatus.PUBLISHED
        self.published_at = timezone.now()
        if self.post_type in (PostType.STORY, PostType.STATUS):
            self.expires_at = self.published_at + timezone.timedelta(hours=24)
        self.save(update_fields=["status", "published_at", "expires_at"])

    @property
    def is_expired(self):
        if self.expires_at is None:
            return False
        from django.utils import timezone
        return timezone.now() > self.expires_at

    @property
    def is_sponsored(self):
        """Whether this post is currently boosted via an active ad
        campaign. Cross-app lookup into monetization is fine here — the
        alternative (a mirrored boolean field kept manually in sync)
        risks drifting out of date; this always reflects reality."""
        return self.boostedcontent_set.filter(
            campaign__status="ACTIVE",
        ).exists()


class PostMedia(models.Model):
    class MediaType(models.TextChoices):
        PHOTO = "PHOTO", "Photo"
        VIDEO = "VIDEO", "Video"
        AUDIO = "AUDIO", "Audio"

    post = models.ForeignKey(Post, on_delete=models.CASCADE, related_name="media")
    media_type = models.CharField(max_length=10, choices=MediaType.choices)
    file_url = models.URLField()
    order = models.PositiveSmallIntegerField(default=0)

    class Meta:
        db_table = "post_media"
        ordering = ["order"]


class PosterAttribution(models.Model):
    """Mandatory, one-per-Post record of who posted it, in what role, and
    where/when — a viewer should never have to guess whether they're
    talking to the landlord directly or an agent working on commission."""
    post = models.OneToOneField(Post, on_delete=models.CASCADE, related_name="attribution")
    poster_role = models.CharField(max_length=20, choices=PosterRole.choices)
    latitude = models.DecimalField(max_digits=10, decimal_places=7, null=True, blank=True)
    longitude = models.DecimalField(max_digits=10, decimal_places=7, null=True, blank=True)
    posted_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "poster_attributions"


class Follow(models.Model):
    follower = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="following",
    )
    followee = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="followers",
    )
    followed_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "follows"
        unique_together = [("follower", "followee")]  # can't follow the same person twice


class EmojiType(models.TextChoices):
    LIKE = "LIKE", "👍"
    LOVE = "LOVE", "❤️"
    LAUGH = "LAUGH", "😂"
    WOW = "WOW", "😮"
    SAD = "SAD", "😢"


class Reaction(models.Model):
    author = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    post = models.ForeignKey(Post, on_delete=models.CASCADE, related_name="reactions")
    emoji = models.CharField(max_length=10, choices=EmojiType.choices)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "reactions"
        unique_together = [("author", "post")]  # one reaction per person per post


class Comment(models.Model):
    author = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    post = models.ForeignKey(Post, on_delete=models.CASCADE, related_name="comments")
    text = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)
    edited_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "comments"

    def edit(self, new_text: str, editor):
        """Only the original author may edit their own comment — this check
        lives here, in one place, rather than being re-implemented (and
        potentially forgotten) at every place a comment might be edited."""
        if editor.id != self.author_id:
            raise PermissionError("Only the comment's author can edit it.")
        from django.utils import timezone
        self.text = new_text
        self.edited_at = timezone.now()
        self.save(update_fields=["text", "edited_at"])

    def delete_by(self, requester):
        if requester.id != self.author_id:
            raise PermissionError("Only the comment's author can delete it.")
        self.delete()


class Review(models.Model):
    """Tied to a completed Booking so only people who actually transacted
    can leave a review — this is what makes reviews trustworthy rather
    than open to anyone with an opinion and no real experience."""
    author = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    booking = models.ForeignKey("transactions.Booking", on_delete=models.CASCADE, related_name="reviews")
    score = models.PositiveSmallIntegerField()  # 1-5
    text = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    edited_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "reviews"

    def edit(self, new_text, new_score, editor):
        if editor.id != self.author_id:
            raise PermissionError("Only the review's author can edit it.")
        from django.utils import timezone
        self.text, self.score = new_text, new_score
        self.edited_at = timezone.now()
        self.save(update_fields=["text", "score", "edited_at"])

    def delete_by(self, requester):
        if requester.id != self.author_id:
            raise PermissionError("Only the review's author can delete it.")
        self.delete()


class Rating(models.Model):
    """A lighter-weight star rating on an agent, agency, or property —
    distinct from Review, which requires a completed transaction and a
    written component."""
    author = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    subject_user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, null=True, blank=True,
        related_name="ratings_received",
    )
    subject_property_id = models.UUIDField(null=True, blank=True)
    score = models.DecimalField(max_digits=3, decimal_places=2)  # e.g. 4.5
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "ratings"


class Channel(models.TextChoices):
    WHATSAPP = "WHATSAPP", "WhatsApp"
    SMS = "SMS", "SMS"
    FACEBOOK = "FACEBOOK", "Facebook"
    TIKTOK = "TIKTOK", "TikTok"
    LINKEDIN = "LINKEDIN", "LinkedIn"
    IN_APP = "IN_APP", "In-App"


class ShareEvent(models.Model):
    """Records WHICH channel content was shared through — this is what lets
    the platform later answer 'does WhatsApp sharing actually drive more
    bookings than Facebook sharing', not just 'sharing happened'."""
    shared_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    post = models.ForeignKey(Post, on_delete=models.CASCADE, null=True, blank=True)
    listing_id = models.UUIDField(null=True, blank=True)
    channel = models.CharField(max_length=20, choices=Channel.choices)
    shared_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "share_events"


class ReferralStatus(models.TextChoices):
    PENDING = "PENDING", "Pending"
    QUALIFIED = "QUALIFIED", "Qualified"
    REWARDED = "REWARDED", "Rewarded"


class Referral(models.Model):
    """A first-class, auditable record — not just a promo code — so a
    reward can be traced back to exactly which referral earned it."""
    referrer = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="referrals_made",
    )
    referred_user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="referred_by",
    )
    status = models.CharField(max_length=20, choices=ReferralStatus.choices, default=ReferralStatus.PENDING)
    reward_earned_xaf = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "referrals"
        unique_together = [("referrer", "referred_user")]


class Group(models.Model):
    name = models.CharField(max_length=200)
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="owned_groups")
    members = models.ManyToManyField(settings.AUTH_USER_MODEL, related_name="joined_groups", blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "groups_"  # trailing underscore avoids clashing with Django's built-in auth Group


class PresenceStatus(models.TextChoices):
    ONLINE = "ONLINE", "Online"
    AWAY = "AWAY", "Away"
    OFFLINE = "OFFLINE", "Offline"


PRESENCE_TIMEOUT_MINUTES = 5  # no heartbeat within this window = treated as offline, regardless of stored status


class UserPresence(models.Model):
    """WHY status alone isn't trusted, and last_seen_at is what actually
    decides offline: a mobile app that crashes or loses signal never
    gets to explicitly set itself OFFLINE — it just stops sending
    heartbeats. is_currently_online() below treats a stale last_seen_at
    as offline regardless of the stored status, so a crashed app doesn't
    show as permanently 'online' to everyone else."""
    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="presence")
    status = models.CharField(max_length=10, choices=PresenceStatus.choices, default=PresenceStatus.OFFLINE)
    last_seen_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "user_presence"

    def is_currently_online(self) -> bool:
        from django.utils import timezone
        from datetime import timedelta
        if self.status == PresenceStatus.OFFLINE:
            return False
        return timezone.now() - self.last_seen_at < timedelta(minutes=PRESENCE_TIMEOUT_MINUTES)


class Conversation(models.Model):
    participants = models.ManyToManyField(settings.AUTH_USER_MODEL, related_name="conversations")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "conversations"


class MessageFolder(models.TextChoices):
    """WHY a status/folder field on the existing Message rather than a
    second messaging system: a draft, a scheduled message, and a sent
    message are the SAME underlying object at different points in its
    life — sent_at being null already distinguished drafts implicitly;
    this makes every state explicit and queryable (an inbox view, a
    trash view, a drafts view are now just filters on one field)."""
    DRAFT = "DRAFT", "Draft"
    SCHEDULED = "SCHEDULED", "Scheduled"
    SENT = "SENT", "Sent"
    ARCHIVED = "ARCHIVED", "Archived"
    TRASH = "TRASH", "Trash"
    SPAM = "SPAM", "Spam"


TRASH_RETENTION_DAYS = 30  # a trashed message is recoverable for this long before real deletion


class Message(models.Model):
    """WHY client_message_id exists: a mobile app composing a message
    while offline (per the founder's explicit 'offline messaging'
    requirement) must be able to safely RETRY sending it once
    connectivity returns, without risking a duplicate if the first
    attempt actually succeeded but the confirmation never reached the
    device. The client generates this ID once, locally, at compose
    time — the same idempotency-key pattern already used for Booking."""
    conversation = models.ForeignKey(Conversation, on_delete=models.CASCADE, related_name="messages")
    sender = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    text = models.TextField(blank=True)
    client_message_id = models.CharField(max_length=100, unique=True, null=True, blank=True)
    folder = models.CharField(max_length=10, choices=MessageFolder.choices, default=MessageFolder.SENT)
    scheduled_send_at = models.DateTimeField(null=True, blank=True)  # set only when folder=SCHEDULED
    sent_at = models.DateTimeField(null=True, blank=True)  # null while still a DRAFT/SCHEDULED
    trashed_at = models.DateTimeField(null=True, blank=True)  # drives the retention window
    created_at = models.DateTimeField(auto_now_add=True)
    read_receipt = models.BooleanField(default=False)

    class Meta:
        db_table = "messages"
        ordering = ["created_at"]

    def move_to_trash(self):
        from django.utils import timezone
        self.folder = MessageFolder.TRASH
        self.trashed_at = timezone.now()
        self.save(update_fields=["folder", "trashed_at"])

    def restore_from_trash(self):
        self.folder = MessageFolder.SENT if self.sent_at else MessageFolder.DRAFT
        self.trashed_at = None
        self.save(update_fields=["folder", "trashed_at"])

    def archive(self):
        self.folder = MessageFolder.ARCHIVED
        self.save(update_fields=["folder"])

    def mark_spam(self):
        self.folder = MessageFolder.SPAM
        self.save(update_fields=["folder"])


class Favorite(models.Model):
    """A private save — deliberately separate from Follow (following a
    PERSON) and ShareEvent (sharing TO others). Saving a listing tells no
    one else anything; that's the point of it."""
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="favorites")
    listing_id = models.UUIDField(null=True, blank=True)
    post = models.ForeignKey(Post, on_delete=models.CASCADE, null=True, blank=True)
    saved_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "favorites"


class CelebrationType(models.TextChoices):
    BIRTHDAY = "BIRTHDAY", "Birthday"
    NEW_YEAR = "NEW_YEAR", "New Year"
    NATIONAL_DAY = "NATIONAL_DAY", "National Day"
    PLATFORM_ANNIVERSARY = "PLATFORM_ANNIVERSARY", "Platform Anniversary"


class CelebrationEvent(models.Model):
    """A scheduled trigger for an automatic greeting. National days are
    scoped per-country (not hardcoded to Cameroon) so this works if
    Oaziland expands elsewhere."""
    celebration_type = models.CharField(max_length=30, choices=CelebrationType.choices)
    occurs_on = models.DateField()
    country = models.ForeignKey("geo.Country", on_delete=models.CASCADE, null=True, blank=True)

    class Meta:
        db_table = "celebration_events"


class PostNotificationSubscription(models.Model):
    """A VIEWER opting in to be notified about activity on a specific
    post (new comments, updates) — distinct from Favorite (a private
    save with no notification implication)."""
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="post_subscriptions")
    post = models.ForeignKey(Post, on_delete=models.CASCADE, related_name="notification_subscribers")
    subscribed_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "post_notification_subscriptions"
        unique_together = [("user", "post")]


class ConnectionStatus(models.TextChoices):
    PENDING = "PENDING", "Pending"
    ACCEPTED = "ACCEPTED", "Accepted"
    REJECTED = "REJECTED", "Rejected"
    CANCELLED = "CANCELLED", "Cancelled"


class Connection(models.Model):
    """A mutual, LinkedIn-style connection request — deliberately
    DIFFERENT from Follow (one-directional, no approval needed). A
    Connection requires the other person to accept before it counts as
    mutual, which is what 'accept/reject/cancel/confirm' in the request
    refers to."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    requester = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="connections_sent")
    recipient = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="connections_received")
    status = models.CharField(max_length=10, choices=ConnectionStatus.choices, default=ConnectionStatus.PENDING)
    created_at = models.DateTimeField(auto_now_add=True)
    resolved_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "connections"
        unique_together = [("requester", "recipient")]

    def accept(self, responder):
        if responder.id != self.recipient_id:
            raise PermissionError("Only the recipient can accept a connection request.")
        self._resolve(ConnectionStatus.ACCEPTED)

    def reject(self, responder):
        if responder.id != self.recipient_id:
            raise PermissionError("Only the recipient can reject a connection request.")
        self._resolve(ConnectionStatus.REJECTED)

    def cancel(self, canceller):
        if canceller.id != self.requester_id:
            raise PermissionError("Only the requester can cancel their own connection request.")
        self._resolve(ConnectionStatus.CANCELLED)

    def _resolve(self, new_status):
        from django.utils import timezone
        self.status = new_status
        self.resolved_at = timezone.now()
        self.save(update_fields=["status", "resolved_at"])


class Poll(models.Model):
    post = models.OneToOneField(Post, on_delete=models.CASCADE, related_name="poll")
    question = models.CharField(max_length=300)
    created_at = models.DateTimeField(auto_now_add=True)
    closes_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "polls"

    @property
    def is_closed(self):
        if self.closes_at is None:
            return False
        from django.utils import timezone
        return timezone.now() > self.closes_at


class PollOption(models.Model):
    poll = models.ForeignKey(Poll, on_delete=models.CASCADE, related_name="options")
    text = models.CharField(max_length=200)

    class Meta:
        db_table = "poll_options"

    @property
    def vote_count(self):
        return self.votes.count()


class PollVote(models.Model):
    option = models.ForeignKey(PollOption, on_delete=models.CASCADE, related_name="votes")
    voter = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="poll_votes")
    voted_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "poll_votes"
        # A voter can only vote ONCE per poll — enforced by making the
        # combination of (poll, voter) unique via a constraint that spans
        # the option's parent poll, checked in application code (see
        # social/services.py) since Django can't express a cross-table
        # uniqueness constraint like this directly in Meta.


class LiveSessionStatus(models.TextChoices):
    SCHEDULED = "SCHEDULED", "Scheduled"
    LIVE = "LIVE", "Live"
    ENDED = "ENDED", "Ended"


class LiveSession(models.Model):
    """A TikTok-style live broadcast. Gated behind a minimum-follower
    threshold — see social/services.py's can_go_live(). The actual video
    streaming infrastructure (e.g. Agora, Mux) is NOT connected yet; this
    models the session's existence and lifecycle so the follower-gating
    rule, chat, and gifting can all be built and tested now, with the
    real video pipe as a clearly separate, later integration."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    broadcaster = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="live_sessions")
    title = models.CharField(max_length=200, blank=True)
    status = models.CharField(max_length=10, choices=LiveSessionStatus.choices, default=LiveSessionStatus.SCHEDULED)
    started_at = models.DateTimeField(null=True, blank=True)
    ended_at = models.DateTimeField(null=True, blank=True)
    peak_viewer_count = models.PositiveIntegerField(default=0)

    class Meta:
        db_table = "live_sessions"

    def go_live(self):
        from django.utils import timezone
        self.status = LiveSessionStatus.LIVE
        self.started_at = timezone.now()
        self.save(update_fields=["status", "started_at"])

    def end(self):
        from django.utils import timezone
        self.status = LiveSessionStatus.ENDED
        self.ended_at = timezone.now()
        self.save(update_fields=["status", "ended_at"])


class LiveChatMessage(models.Model):
    """In-session chat during a live broadcast — deliberately separate
    from Message (which belongs to a private Conversation) since live
    chat is public, ephemeral, and tied to a broadcast, not a DM thread."""
    live_session = models.ForeignKey(LiveSession, on_delete=models.CASCADE, related_name="chat_messages")
    sender = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    text = models.TextField()
    sent_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "live_chat_messages"
        ordering = ["sent_at"]
