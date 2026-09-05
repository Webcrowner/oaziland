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

    WHY dance-tagged content is explicitly excluded from ever
    receiving a boost, and ranked below all other content: per the
    founder's explicit content policy, the platform does not encourage
    dancing/dance-entertainment content — it stays allowed to exist
    (never auto-flagged or rejected), but the algorithm must never
    push it, regardless of how well it would otherwise match a user's
    interests. This is a real, enforced tier, not a written guideline
    with nothing behind it.

    WHY boosted posts get their own tier, below real estate but above
    everything else: AdPlacement.FEED_BOOSTED_POST existed as a
    purchasable option, and purchase_campaign_boost() actually charges
    real money for it — but the BoostedContent row it created was
    never checked by this function at all, meaning a paid boost bought
    genuinely nothing. A real estate post still wins even if it isn't
    boosted — boosting doesn't let paid content override the
    platform's core content-priority rule, it only lifts a post above
    the OTHER generic, unboosted content it's actually competing with.
    """
    from django.utils import timezone
    from .models import Post, Reaction, Favorite, ContentStatus
    from monetization.models import BoostedContent, AdStatus

    DISCOURAGED_TAG_NAMES = {"dance", "dancing"}

    now = timezone.now()
    boosted_post_ids = set(
        BoostedContent.objects.filter(
            post__isnull=False, campaign__status=AdStatus.ACTIVE,
            campaign__starts_at__lte=now, campaign__ends_at__gte=now,
        ).values_list("post_id", flat=True)
    )

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
        # Case-insensitive: a real user might tag a post "Dance",
        # "DANCING", or "dance" — the policy has to catch all of them,
        # not just one exact casing.
        is_discouraged = any(tag.name.lower() in DISCOURAGED_TAG_NAMES for tag in post.tags.all())
        if is_discouraged:
            # Below every other tier, including plain baseline generic
            # posts — never boosted, never tied with anything else,
            # regardless of tag overlap with the user's own interests.
            scored.append((post, -1))
            continue

        is_real_estate = post.linked_listing_id is not None
        is_boosted = post.id in boosted_post_ids
        shares_interest_tag = post.tags.filter(id__in=interest_tag_ids).exists() if interest_tag_ids else False
        # Real estate is a HARD priority tier (10000+) — always wins,
        # boosted or not. A paid boost lifts a NON-real-estate post
        # into its own tier (5000+), above plain generic content but
        # never above real estate itself.
        if is_real_estate:
            score = 10000 + (1 if shares_interest_tag else 0)
        elif is_boosted:
            score = 5000 + (1 if shares_interest_tag else 0)
        else:
            score = 1 if shares_interest_tag else 0
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
    create_receipts_for_message(message)

    from notifications.services import notify
    for recipient in conversation.participants.exclude(id=sender.id):
        if is_user_online(recipient):
            # An online recipient's device is presumed to receive it
            # immediately — the tick moves straight to DELIVERED.
            mark_message_delivered(message=message, recipient=recipient)
        else:
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


def get_presence_display(user, viewer=None) -> str:
    """Returns a human-readable presence string — 'Online' or 'Last
    seen 12 minutes ago' — the actual thing a chat UI would show next to
    someone's name.

    WHY `viewer` matters: if `user` has hidden their online status
    (UserPresence.show_online_status=False), everyone EXCEPT the user
    themselves sees a generic 'Offline' — checking your own profile
    always shows your real status, since hiding it from yourself would
    just be confusing, not private. Pass viewer=user (or leave it
    unset, for 'some other/public viewer') depending on who's asking."""
    from django.utils import timezone
    from .models import UserPresence

    presence = UserPresence.objects.filter(user=user).first()
    if presence is None:
        return "Offline"

    is_own_status_check = viewer is not None and viewer.id == user.id
    if not presence.show_online_status and not is_own_status_check:
        return "Offline"

    if presence.is_currently_online():
        return "Online"

    delta = timezone.now() - presence.last_seen_at
    minutes = int(delta.total_seconds() // 60)
    if minutes < 60:
        return f"Last seen {minutes} minute{'s' if minutes != 1 else ''} ago"
    hours = minutes // 60
    return f"Last seen {hours} hour{'s' if hours != 1 else ''} ago"


def set_presence_visibility(*, user, visible: bool):
    """Toggles whether OTHER people can see this user's real online
    status. Does NOT affect is_user_online()/is_currently_online() —
    the underlying functional presence detection message delivery
    ticks rely on keeps working correctly regardless of this setting."""
    from .models import UserPresence
    presence, _ = UserPresence.objects.get_or_create(user=user)
    presence.show_online_status = visible
    presence.save(update_fields=["show_online_status"])
    return presence


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


# ---------------------------------------------------------------------------
# Follow — one-tap follow/unfollow (the founder's 'tap to give or get
# followers' requirement).
# ---------------------------------------------------------------------------
def follow_user(*, follower, followee):
    if follower.id == followee.id:
        raise ValueError("A user cannot follow themselves.")
    from .models import Follow
    relationship, _ = Follow.objects.get_or_create(follower=follower, followee=followee)
    return relationship


def unfollow_user(*, follower, followee):
    from .models import Follow
    Follow.objects.filter(follower=follower, followee=followee).delete()


def is_following(*, follower, followee) -> bool:
    from .models import Follow
    return Follow.objects.filter(follower=follower, followee=followee).exists()


def toggle_follow(*, follower, followee):
    """The actual 'one tap' behavior: a single button whose action
    depends on current state — already following, unfollow; not yet
    following, follow. Returns (is_now_following: bool)."""
    if is_following(follower=follower, followee=followee):
        unfollow_user(follower=follower, followee=followee)
        return False
    follow_user(follower=follower, followee=followee)
    return True


def is_mutual_follow(*, user_a, user_b) -> bool:
    """Both follow each other — the 'get followers' half: shown on a
    profile as 'Follows you' alongside the tap-to-follow button."""
    return is_following(follower=user_a, followee=user_b) and is_following(follower=user_b, followee=user_a)


# ---------------------------------------------------------------------------
# Message delivery ticks — sent / delivered / seen, WhatsApp-style,
# generalized to group conversations via a per-recipient receipt.
# ---------------------------------------------------------------------------
def create_receipts_for_message(message):
    """Called right after a message is created — one MessageReceipt per
    OTHER participant in the conversation. WHY per-recipient rather than
    a single delivered_at/seen_at on Message itself: a group chat with
    5 people needs to know delivery/read status PER PERSON, not one
    shared timestamp that only makes sense for a 1:1 conversation."""
    from .models import MessageReceipt
    other_participants = message.conversation.participants.exclude(id=message.sender_id)
    return [
        MessageReceipt.objects.get_or_create(message=message, recipient=participant)[0]
        for participant in other_participants
    ]


def mark_message_delivered(*, message, recipient):
    """Idempotent — delivering the same message twice to the same
    device (a common real-world occurrence) never overwrites an
    earlier, more accurate delivered_at with a later one."""
    from django.utils import timezone
    from .models import MessageReceipt
    receipt, _ = MessageReceipt.objects.get_or_create(message=message, recipient=recipient)
    if receipt.delivered_at is None:
        receipt.delivered_at = timezone.now()
        receipt.save(update_fields=["delivered_at"])
    return receipt


def mark_message_seen(*, message, recipient):
    """Seeing a message implies it was also delivered — sets both if
    delivered_at was somehow never recorded, since a message can't be
    read without having arrived."""
    from django.utils import timezone
    from .models import MessageReceipt
    receipt, _ = MessageReceipt.objects.get_or_create(message=message, recipient=recipient)
    now = timezone.now()
    updated_fields = []
    if receipt.delivered_at is None:
        receipt.delivered_at = now
        updated_fields.append("delivered_at")
    if receipt.seen_at is None:
        receipt.seen_at = now
        updated_fields.append("seen_at")
    if updated_fields:
        receipt.save(update_fields=updated_fields)
    return receipt


def get_message_tick_status(message) -> dict:
    """The actual UI-facing answer: how many ticks, what color. ALL
    recipients must have reached a state for the sender to see it at
    that level — a group message shows 'delivered' only once everyone
    has received it, matching how WhatsApp itself behaves for groups."""
    from .models import MessageReceipt

    receipts = MessageReceipt.objects.filter(message=message)
    if not receipts.exists():
        return {"ticks": 1, "color": "GREY", "label": "Sent"}

    if all(r.seen_at is not None for r in receipts):
        return {"ticks": 2, "color": "BLUE", "label": "Seen"}
    if all(r.delivered_at is not None for r in receipts):
        return {"ticks": 2, "color": "GREY", "label": "Delivered"}
    return {"ticks": 1, "color": "GREY", "label": "Sent"}


# ---------------------------------------------------------------------------
# Typing indicators — heartbeat-based (this backend is REST, not
# WebSocket), with a per-user privacy toggle mirroring UserPresence.
# show_online_status exactly: visible by default, hideable, and
# hiding it never touches whether typing is actually being detected.
# ---------------------------------------------------------------------------
TYPING_TIMEOUT_SECONDS = 8  # a heartbeat older than this means "no longer typing"


def send_typing_heartbeat(*, conversation, user):
    """Called repeatedly by the client (every few seconds) while the
    user is actively composing — upserts a single row per (conversation,
    user), so this is safe to call as often as needed without creating
    a growing pile of history nobody needs."""
    from .models import TypingIndicator
    indicator, _ = TypingIndicator.objects.update_or_create(conversation=conversation, user=user)
    return indicator


def get_typing_users(*, conversation, viewer):
    """The actual answer a chat UI polls for: who (other than the
    viewer themselves) is CURRENTLY typing in this conversation right
    now. Two independent reasons a typing user is excluded: their
    heartbeat has gone stale (TYPING_TIMEOUT_SECONDS), or they've
    explicitly turned off show_typing_indicator — checked here, not
    left to the caller to remember, so there's exactly one place this
    privacy rule is enforced."""
    from django.utils import timezone
    from datetime import timedelta
    from .models import TypingIndicator

    cutoff = timezone.now() - timedelta(seconds=TYPING_TIMEOUT_SECONDS)
    active = TypingIndicator.objects.filter(
        conversation=conversation, last_heartbeat_at__gte=cutoff,
    ).exclude(user=viewer).select_related("user", "user__presence")

    visible_typists = []
    for indicator in active:
        presence = getattr(indicator.user, "presence", None)
        if presence is not None and not presence.show_typing_indicator:
            continue  # this user has explicitly hidden their typing status
        visible_typists.append(indicator.user)
    return visible_typists


# ---------------------------------------------------------------------------
# Connected social accounts — display links to a user's other social
# presence (Facebook, TikTok, Instagram, etc.) on their Oaziland profile.
# ---------------------------------------------------------------------------
def link_social_account(*, user, platform: str, handle_or_url: str):
    """Adds or REPLACES the link for a given platform — a user adding
    their TikTok twice (e.g. after changing their handle) updates the
    existing link rather than creating a confusing duplicate."""
    from .models import SocialAccountLink
    link, _ = SocialAccountLink.objects.update_or_create(
        user=user, platform=platform, defaults={"handle_or_url": handle_or_url},
    )
    return link


def unlink_social_account(*, user, platform: str):
    from .models import SocialAccountLink
    SocialAccountLink.objects.filter(user=user, platform=platform).delete()


def list_social_accounts(user):
    from .models import SocialAccountLink
    return SocialAccountLink.objects.filter(user=user)


# ---------------------------------------------------------------------------
# Referral processing — a Referral record is a real, auditable trail
# from a specific promo code to a specific new signup, through
# qualification, to an actual paid reward.
# ---------------------------------------------------------------------------
REFERRAL_REWARD_XAF = 2000  # a real, working starting default — easy to tune later


class InvalidReferralCodeError(Exception):
    pass


def process_referral_signup(*, new_user, referral_code: str):
    """Called right after registration if the new user entered a
    referral code — looks up the real referrer by their persistent
    code and creates the auditable Referral record. Never silently
    fails on an unknown code: a typo shouldn't create a phantom
    referral, and the caller (the registration flow) should tell the
    new user their code didn't match anything."""
    from identity.models import User
    from .models import Referral

    try:
        referrer = User.objects.get(referral_code=referral_code)
    except User.DoesNotExist:
        raise InvalidReferralCodeError("This referral code doesn't match any user.")

    if referrer.id == new_user.id:
        raise InvalidReferralCodeError("You cannot refer yourself.")

    return Referral.objects.create(referrer=referrer, referred_user=new_user)


def qualify_referral(referred_user):
    """A referral only 'counts' once the referred person actually does
    something real on the platform — per this implementation, completing
    KYC (the same real milestone the platform already treats as
    'registration complete' elsewhere) — not just creating an account,
    which would make the reward trivially gameable with throwaway signups."""
    from identity.services import user_has_submitted_kyc
    from .models import Referral, ReferralStatus

    if not user_has_submitted_kyc(referred_user):
        return None

    referral = Referral.objects.filter(referred_user=referred_user, status=ReferralStatus.PENDING).first()
    if referral is None:
        return None

    referral.status = ReferralStatus.QUALIFIED
    referral.save(update_fields=["status"])
    return referral


def award_referral_reward(referral, amount_xaf=None):
    """Actually pays the referrer — credits their real Wallet (the
    same wallet every other payout in this platform uses), with a
    genuine WalletTransaction audit trail, not just a status flip with
    no money behind it."""
    from django.db import transaction as db_transaction
    from monetization.services import get_or_create_wallet
    from monetization.models import WalletTransaction, WalletTransactionType
    from decimal import Decimal
    from .models import ReferralStatus

    if referral.status == ReferralStatus.REWARDED:
        return referral  # never pay the same referral twice

    amount = Decimal(str(amount_xaf if amount_xaf is not None else REFERRAL_REWARD_XAF))
    wallet = get_or_create_wallet(referral.referrer)

    with db_transaction.atomic():
        wallet.balance_xaf += amount
        wallet.save(update_fields=["balance_xaf"])
        WalletTransaction.objects.create(
            wallet=wallet, transaction_type=WalletTransactionType.GIFT_PAYOUT,
            amount_xaf=amount, platform_fee_xaf=Decimal("0"),
            related_reference=f"Referral reward for referring {referral.referred_user.username}",
        )
        referral.status = ReferralStatus.REWARDED
        referral.reward_earned_xaf = amount
        referral.save(update_fields=["status", "reward_earned_xaf"])

    return referral
