import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useVideoPlayer, VideoView } from "expo-video";
import type { ReelPost } from "../../lib/api";
import { compactCount, reactionTotal, videoPoster, videoSource } from "../../lib/videos";
import { useI18n } from "../../i18n";

const DOUBLE_TAP_MS = 300;

export interface ReelSlideProps {
  post: ReelPost;
  height: number;
  /** The clip on screen: only this one mounts a player, so a long feed stays light. */
  active: boolean;
  muted: boolean;
  onToggleMute: () => void;
  onLike: (post: ReelPost) => void;
  onSave: (post: ReelPost) => void;
  onFollow: (post: ReelPost) => void;
  onOpenComments: (post: ReelPost) => void;
  onShare: (post: ReelPost) => void;
  onOpenMore: (post: ReelPost) => void;
  onTagPress: (tag: string) => void;
  onOpenListing: (listingId: string) => void;
}

function Player({ uri, playing, muted, onReady, onFailed }: { uri: string; playing: boolean; muted: boolean; onReady: () => void; onFailed: () => void }) {
  const player = useVideoPlayer(uri, (p) => { p.loop = true; });

  useEffect(() => { player.muted = muted; }, [player, muted]);
  useEffect(() => {
    if (playing) player.play();
    else player.pause();
  }, [player, playing]);
  useEffect(() => {
    const sub = player.addListener("statusChange", ({ status }) => {
      if (status === "readyToPlay") onReady();
      else if (status === "error") onFailed();
    });
    return () => sub.remove();
  }, [player, onReady, onFailed]);

  return <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="contain" nativeControls={false} />;
}

function RailButton({ glyph, label, count, onPress, highlighted }: { glyph: string; label: string; count?: string; onPress: () => void; highlighted?: boolean }) {
  return (
    <TouchableOpacity style={styles.railButton} onPress={onPress} accessibilityLabel={label} accessibilityRole="button">
      <Text style={[styles.railGlyph, highlighted && styles.railGlyphOn]}>{glyph}</Text>
      {count !== undefined && <Text style={styles.railCount}>{count}</Text>}
    </TouchableOpacity>
  );
}

/** One full-screen clip with the side rail (like, comments, save, share, sound, more) and the caption block. */
export default function ReelSlide(props: ReelSlideProps) {
  const { post, height, active, muted } = props;
  const { t } = useI18n();
  const uri = videoSource(post);
  const poster = videoPoster(post);
  const [paused, setPaused] = useState(false);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [heart, setHeart] = useState(false);
  const lastTap = useRef(0);
  const tapTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (!active) {
      setPaused(false);
      setReady(false);
    }
  }, [active]);
  useEffect(() => () => clearTimeout(tapTimer.current), []);

  const liked = post.my_reaction === "LOVE";

  function handleTap() {
    const now = Date.now();
    clearTimeout(tapTimer.current);
    if (now - lastTap.current < DOUBLE_TAP_MS) {
      lastTap.current = 0;
      if (!liked) props.onLike(post);
      setHeart(true);
      setTimeout(() => setHeart(false), 700);
      return;
    }
    lastTap.current = now;
    tapTimer.current = setTimeout(() => setPaused((p) => !p), DOUBLE_TAP_MS);
  }

  const preview = post.listing_preview;
  const playing = active && !paused && !failed;

  return (
    <View style={[styles.slide, { height }]}>
      {poster ? <Image source={{ uri: poster }} style={StyleSheet.absoluteFill} resizeMode="cover" blurRadius={18} /> : null}
      {active && uri && !failed ? (
        <Player uri={uri} playing={playing} muted={muted} onReady={() => setReady(true)} onFailed={() => setFailed(true)} />
      ) : null}
      {poster && !(active && ready) ? <Image source={{ uri: poster }} style={StyleSheet.absoluteFill} resizeMode="contain" /> : null}

      <Pressable style={StyleSheet.absoluteFill} onPress={handleTap} accessibilityLabel={paused ? "Play" : "Pause"} />

      {active && uri && !ready && !failed ? <ActivityIndicator style={styles.spinner} color="#fff" /> : null}
      {failed ? <Text style={styles.failed}>{t("videos.playFailed")}</Text> : null}
      {paused && !failed ? <Text style={styles.pausedIcon}>▶</Text> : null}
      {heart ? <Text style={styles.heartBurst}>❤️</Text> : null}

      <View style={styles.rail} pointerEvents="box-none">
        <View>
          <Text style={styles.avatar}>{(post.author_name.charAt(0) || "?").toUpperCase()}</Text>
          {!post.is_mine && (
            <TouchableOpacity
              style={[styles.followBadge, post.is_following_author && styles.followBadgeOn]}
              onPress={() => props.onFollow(post)}
              accessibilityLabel={post.is_following_author ? t("videos.following") : t("videos.follow")}
            >
              <Text style={styles.followBadgeText}>{post.is_following_author ? "✓" : "+"}</Text>
            </TouchableOpacity>
          )}
        </View>
        <RailButton glyph={liked ? "❤️" : "🤍"} label={t("videos.like")} count={compactCount(reactionTotal(post.reaction_counts))} onPress={() => props.onLike(post)} />
        <RailButton glyph="💬" label={t("videos.comments")} count={compactCount(post.comment_count)} onPress={() => props.onOpenComments(post)} />
        <RailButton glyph={post.is_saved ? "🔖" : "📑"} label={t("videos.save")} onPress={() => props.onSave(post)} highlighted={post.is_saved} />
        <RailButton glyph="↗" label={t("videos.share")} count={compactCount(post.share_count)} onPress={() => props.onShare(post)} />
        <RailButton glyph={muted ? "🔇" : "🔊"} label={muted ? t("videos.unmute") : t("videos.mute")} onPress={props.onToggleMute} />
        <RailButton glyph="⋯" label={t("videos.more")} onPress={() => props.onOpenMore(post)} />
      </View>

      <View style={styles.info} pointerEvents="box-none">
        <Text style={styles.author}>@{post.author_username || post.author_name}{post.is_verified_creator ? "  ✔" : ""}</Text>
        {post.caption ? <Text style={styles.caption} numberOfLines={3}>{post.caption}</Text> : null}
        {post.tag_names.length > 0 && (
          <Text style={styles.tags} numberOfLines={1}>
            {post.tag_names.map((tag) => (
              <Text key={tag} onPress={() => props.onTagPress(tag)}>#{tag}  </Text>
            ))}
          </Text>
        )}
        {preview && (
          <TouchableOpacity style={styles.listingCard} onPress={() => props.onOpenListing(preview.id)} accessibilityRole="button">
            <View style={{ flex: 1 }}>
              <Text style={styles.listingKind}>{preview.listing_type === "SALE" ? t("videos.forSale") : t("videos.forRent")} · {preview.property_type}</Text>
              <Text style={styles.listingPrice}>{Number(preview.price_xaf).toLocaleString()} XAF · {preview.quarter}</Text>
              {!preview.is_available && <Text style={styles.listingKind}>{t("videos.unavailable")}</Text>}
            </View>
            <Text style={styles.listingCta}>{t("videos.viewProperty")} ›</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  slide: { width: "100%", backgroundColor: "#000", overflow: "hidden" },
  spinner: { position: "absolute", top: "50%", alignSelf: "center" },
  failed: { position: "absolute", top: "45%", alignSelf: "center", color: "#fff", backgroundColor: "rgba(0,0,0,0.6)", padding: 12, borderRadius: 8 },
  pausedIcon: { position: "absolute", top: "42%", alignSelf: "center", color: "rgba(255,255,255,0.85)", fontSize: 64 },
  heartBurst: { position: "absolute", top: "40%", alignSelf: "center", fontSize: 90 },
  rail: { position: "absolute", right: 10, bottom: 28, alignItems: "center", gap: 14 },
  avatar: { width: 46, height: 46, borderRadius: 23, backgroundColor: "#1B2A4A", borderWidth: 2, borderColor: "#fff", color: "#FBBF24", textAlign: "center", textAlignVertical: "center", lineHeight: 42, fontWeight: "700", fontSize: 18, overflow: "hidden" },
  followBadge: { position: "absolute", bottom: -9, alignSelf: "center", width: 20, height: 20, borderRadius: 10, backgroundColor: "#F43F5E", alignItems: "center", justifyContent: "center" },
  followBadgeOn: { backgroundColor: "#10B981" },
  followBadgeText: { color: "#fff", fontWeight: "800", fontSize: 12, lineHeight: 16 },
  railButton: { alignItems: "center", minWidth: 44 },
  railGlyph: { fontSize: 28, color: "#fff", textShadowColor: "rgba(0,0,0,0.7)", textShadowRadius: 3 },
  railGlyphOn: { color: "#FBBF24" },
  railCount: { color: "#fff", fontSize: 12, fontWeight: "700", marginTop: 2 },
  info: { position: "absolute", left: 14, right: 84, bottom: 28 },
  author: { color: "#fff", fontWeight: "800", fontSize: 15, marginBottom: 4, textShadowColor: "rgba(0,0,0,0.7)", textShadowRadius: 3 },
  caption: { color: "#fff", fontSize: 14, marginBottom: 4, textShadowColor: "rgba(0,0,0,0.7)", textShadowRadius: 3 },
  tags: { color: "#FCD34D", fontSize: 13, fontWeight: "700", marginBottom: 8 },
  listingCard: { flexDirection: "row", alignItems: "center", backgroundColor: "rgba(255,255,255,0.92)", borderRadius: 12, padding: 10, gap: 8 },
  listingKind: { color: "#8A6D14", fontSize: 11, fontWeight: "700", textTransform: "uppercase" },
  listingPrice: { color: "#1B2A4A", fontSize: 14, fontWeight: "800" },
  listingCta: { color: "#1B2A4A", fontSize: 12, fontWeight: "700" },
});
