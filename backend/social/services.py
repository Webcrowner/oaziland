"""
social.services — business rules that don't belong on the models
themselves: the go-live follower threshold, one-vote-per-poll
enforcement, friend/connection suggestions, and the recommendation feed.
"""
from django.db.models import Count, Q


MIN_FOLLOWERS_TO_GO_LIVE = 100  # adjustable threshold — not hardcoded deep in view/API code


class NotEnoughFollowersError(Exception):
    pass


class AlreadyVotedError(Exception):
    pass


def can_go_live(user) -> bool:
    from .models import Follow
    return Follow.objects.filter(followee=user).count() >= MIN_FOLLOWERS_TO_GO_LIVE


def start_live_session(*, broadcaster, title=""):
    """Creates and starts a LiveSession — but only if the broadcaster has
    reached the minimum follower threshold. This is the actual
    ENFORCEMENT of the 'go live after enough followers' rule; without
    this check, LiveSession.go_live() alone would let anyone start
    broadcasting regardless of follower count."""
    if not can_go_live(broadcaster):
        from .models import Follow
        current = Follow.objects.filter(followee=broadcaster).count()
        raise NotEnoughFollowersError(
            f"You need at least {MIN_FOLLOWERS_TO_GO_LIVE} followers to go live "
            f"(you currently have {current})."
        )
    from .models import LiveSession
    session = LiveSession.objects.create(broadcaster=broadcaster, title=title)
    session.go_live()
    return session


def cast_poll_vote(*, poll, option, voter):
    """Enforces one vote per person per poll — checked here in
    application code since a poll's options live in a separate table
    from the poll itself, so a plain database uniqueness constraint can't
    express 'one vote per (poll, voter)' directly."""
    from .models import PollVote
    if poll.is_closed:
        raise ValueError("This poll is closed.")
    already_voted = PollVote.objects.filter(option__poll=poll, voter=voter).exists()
    if already_voted:
        raise AlreadyVotedError("You have already voted in this poll.")
    return PollVote.objects.create(option=option, voter=voter)


def suggest_connections(user, limit=10):
    """'Always recommend friends, connections and followers' — suggests
    people the user isn't already connected to, ranked by how many
    mutual connections/follows they share (the standard 'people you may
    know' logic: a stranger with 5 mutual friends is a better suggestion
    than a stranger with 0)."""
    from .models import Follow, Connection
    from identity.models import User

    already_connected_ids = set(
        Connection.objects.filter(Q(requester=user) | Q(recipient=user))
        .values_list("requester_id", "recipient_id")
    )
    excluded_ids = {user.id}
    for pair in already_connected_ids:
        excluded_ids.update(pair)

    my_follows = set(Follow.objects.filter(follower=user).values_list("followee_id", flat=True))

    candidates = User.objects.exclude(id__in=excluded_ids)
    scored = []
    for candidate in candidates:
        their_follows = set(Follow.objects.filter(follower=candidate).values_list("followee_id", flat=True))
        mutual_count = len(my_follows & their_follows)
        scored.append((candidate, mutual_count))

    scored.sort(key=lambda pair: pair[1], reverse=True)
    return [user for user, score in scored[:limit]]


def get_recommended_feed(user, limit=20):
    """The 'algorithm should always recommend similar or related posts,
    with real estate as top priority' requirement. Ranking, in order:
      1. Real estate posts (linked_listing_id is set) always outrank
         generic posts — this is a hard priority, not just a scoring
         boost, per the founder's explicit instruction.
      2. Within each group, posts sharing a tag with something the user
         has already liked/favorited rank higher ('similar/related').
      3. Most recent first, as the final tiebreaker.
    """
    from .models import Post, Reaction, Favorite, ContentStatus

    liked_post_ids = Reaction.objects.filter(author=user).values_list("post_id", flat=True)
    favorited_post_ids = Favorite.objects.filter(user=user).exclude(post__isnull=True).values_list("post_id", flat=True)
    interest_tag_ids = set(
        Post.objects.filter(id__in=list(liked_post_ids) + list(favorited_post_ids))
        .values_list("tags__id", flat=True)
    )
    interest_tag_ids.discard(None)

    candidates = Post.objects.filter(status=ContentStatus.PUBLISHED).exclude(author=user)

    scored = []
    for post in candidates:
        is_real_estate = post.linked_listing_id is not None
        shares_interest_tag = post.tags.filter(id__in=interest_tag_ids).exists() if interest_tag_ids else False
        # Real estate is a HARD priority tier (10000+), not just a few
        # extra points — a real estate post always beats a non-real-estate
        # post regardless of tag overlap, per the explicit requirement.
        score = (10000 if is_real_estate else 0) + (1 if shares_interest_tag else 0)
        scored.append((post, score))

    scored.sort(key=lambda pair: (pair[1], pair[0].created_at), reverse=True)
    return [post for post, score in scored[:limit]]


# ---------------------------------------------------------------------------
# Message lifecycle — drafts, scheduled send-later, and the trash
# retention window (Part C of the additional module).
# ---------------------------------------------------------------------------
def save_draft(*, conversation, sender, text):
    from .models import Message, MessageFolder
    return Message.objects.create(conversation=conversation, sender=sender, text=text, folder=MessageFolder.DRAFT)


def schedule_message(*, conversation, sender, text, send_at):
    from .models import Message, MessageFolder
    return Message.objects.create(
        conversation=conversation, sender=sender, text=text,
        folder=MessageFolder.SCHEDULED, scheduled_send_at=send_at,
    )


def send_message_now(*, conversation, sender, text, client_message_id=None):
    """The primary way an ordinary, immediately-sent message gets
    created — sent_at and folder=SENT are always set together, in one
    place, rather than left to whichever caller remembers to set both.

    WHY this checks client_message_id FIRST: this is what makes offline
    sending safe. If a mobile client's first send attempt actually
    reached the server but the success response was lost (a classic
    offline/flaky-connection failure), retrying with the SAME
    client_message_id returns the original message instead of creating
    a duplicate. Also notifies any offline recipient, so a message sent
    to someone who's offline isn't just silently waiting for them to
    happen to open the app."""
    from django.utils import timezone
    from .models import Message, MessageFolder, PresenceStatus

    if client_message_id:
        existing = Message.objects.filter(client_message_id=client_message_id).first()
        if existing:
            return existing

    message = Message.objects.create(
        conversation=conversation, sender=sender, text=text,
        client_message_id=client_message_id, folder=MessageFolder.SENT, sent_at=timezone.now(),
    )

    from notifications.services import notify
    for recipient in conversation.participants.exclude(id=sender.id):
        if not is_user_online(recipient):
            notify(
                recipient=recipient, notification_type="NEW_MESSAGE_WHILE_OFFLINE",
                title=f"New message from {sender.full_name or sender.username}",
                message=text[:100], related_reference=str(message.id),
            )

    return message


# ---------------------------------------------------------------------------
# Presence — online/offline/last-seen (the founder's explicit
# 'I have to know when you are offline or not' requirement).
# ---------------------------------------------------------------------------
def record_heartbeat(user):
    """Called periodically by a connected client (e.g. every 60
    seconds) — the ONLY way status moves to/stays ONLINE. last_seen_at
    updates via auto_now every time this is called."""
    from .models import UserPresence, PresenceStatus
    presence, _ = UserPresence.objects.get_or_create(user=user)
    presence.status = PresenceStatus.ONLINE
    presence.save(update_fields=["status", "last_seen_at"])
    return presence


def set_explicitly_offline(user):
    """Called when a user deliberately logs out or closes the app
    cleanly — distinct from just going silent (a crash/lost connection
    still falls back to the last_seen_at timeout in is_user_online)."""
    from .models import UserPresence, PresenceStatus
    presence, _ = UserPresence.objects.get_or_create(user=user)
    presence.status = PresenceStatus.OFFLINE
    presence.save(update_fields=["status", "last_seen_at"])
    return presence


def is_user_online(user) -> bool:
    from .models import UserPresence
    presence = UserPresence.objects.filter(user=user).first()
    if presence is None:
        return False  # never seen — treated as offline, not an error
    return presence.is_currently_online()


def get_presence_display(user) -> str:
    """Returns a human-readable presence string — 'Online' or 'Last
    seen 12 minutes ago' — the actual thing a chat UI would show next to
    someone's name."""
    from django.utils import timezone
    from .models import UserPresence

    presence = UserPresence.objects.filter(user=user).first()
    if presence is None:
        return "Offline"
    if presence.is_currently_online():
        return "Online"

    delta = timezone.now() - presence.last_seen_at
    minutes = int(delta.total_seconds() // 60)
    if minutes < 60:
        return f"Last seen {minutes} minute{'s' if minutes != 1 else ''} ago"
    hours = minutes // 60
    return f"Last seen {hours} hour{'s' if hours != 1 else ''} ago"


def send_due_scheduled_messages(now=None):
    """Finds every SCHEDULED message whose time has arrived and marks
    it SENT — meant to run on a schedule, fully callable/testable
    directly."""
    from django.utils import timezone
    from .models import Message, MessageFolder

    now = now or timezone.now()
    due = Message.objects.filter(folder=MessageFolder.SCHEDULED, scheduled_send_at__lte=now)
    sent = []
    for message in due:
        message.folder = MessageFolder.SENT
        message.sent_at = now
        message.save(update_fields=["folder", "sent_at"])
        sent.append(message)
    return sent


def purge_expired_trash(now=None):
    """Permanently deletes messages that have sat in Trash beyond the
    retention window — the actual enforcement of 'recoverable retention
    window', not just a comment saying trash should eventually clear."""
    from django.utils import timezone
    from datetime import timedelta
    from .models import Message, MessageFolder, TRASH_RETENTION_DAYS

    now = now or timezone.now()
    cutoff = now - timedelta(days=TRASH_RETENTION_DAYS)
    expired = Message.objects.filter(folder=MessageFolder.TRASH, trashed_at__lt=cutoff)
    count = expired.count()
    expired.delete()
    return count
