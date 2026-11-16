import { useEffect, useState } from "react";
import { View, Text, StyleSheet } from "react-native";
import { getMarketplaceListingReviews, type BrowsableCategory, type MarketplaceReviewSummary } from "../lib/api";
import { distributionPercents, starString } from "../lib/marketplaceReviews";

/** Written reviews from buyers who completed a purchase of this listing; nothing is shown until there is one. */
export default function MarketplaceReviews({ category, listingId }: { category: BrowsableCategory; listingId: string }) {
  const [summary, setSummary] = useState<MarketplaceReviewSummary | null>(null);

  useEffect(() => {
    getMarketplaceListingReviews(category, listingId).then(setSummary).catch(() => setSummary(null));
  }, [category, listingId]);

  if (!summary || summary.count === 0) return null;
  const percents = distributionPercents(summary.distribution, summary.count);

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Reviews</Text>
      <View style={styles.summaryRow}>
        <Text style={styles.average}>{summary.average ?? "–"}</Text>
        <View>
          <Text style={styles.stars}>{starString(summary.average ?? 0)}</Text>
          <Text style={styles.muted}>{summary.count} {summary.count === 1 ? "review" : "reviews"}</Text>
        </View>
      </View>
      {[5, 4, 3, 2, 1].map((score) => (
        <View key={score} style={styles.barRow}>
          <Text style={styles.barLabel}>{score}★</Text>
          <View style={styles.barTrack}><View style={[styles.barFill, { width: `${percents[score]}%` }]} /></View>
          <Text style={styles.barCount}>{summary.distribution[String(score)] ?? 0}</Text>
        </View>
      ))}
      {summary.results.map((review) => (
        <View key={review.id} style={styles.review}>
          <View style={styles.reviewHeader}>
            <Text style={styles.author}>{review.author_name}</Text>
            <Text style={styles.stars}>{starString(review.score)}</Text>
          </View>
          <Text style={styles.muted}>{new Date(review.created_at).toLocaleDateString()}</Text>
          {review.text ? <Text style={styles.text}>{review.text}</Text> : null}
          {review.verified_purchase && <Text style={styles.verified}>✓ Verified purchase</Text>}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: "#fff", borderRadius: 10, borderWidth: 1, borderColor: "#E5E7EB", padding: 14, marginTop: 20 },
  title: { fontSize: 15, fontWeight: "700", color: "#1B2A4A", marginBottom: 8 },
  summaryRow: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 8 },
  average: { fontSize: 32, fontWeight: "700", color: "#1B2A4A" },
  stars: { fontSize: 15, color: "#C9A227" },
  muted: { fontSize: 12, color: "#6B7280" },
  barRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 },
  barLabel: { width: 28, fontSize: 12, color: "#374151" },
  barTrack: { flex: 1, height: 8, borderRadius: 4, backgroundColor: "#E5E7EB", overflow: "hidden" },
  barFill: { height: 8, backgroundColor: "#C9A227" },
  barCount: { width: 24, fontSize: 12, color: "#6B7280", textAlign: "right" },
  review: { borderTopWidth: 1, borderTopColor: "#F3F4F6", marginTop: 10, paddingTop: 10 },
  reviewHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  author: { fontSize: 13, fontWeight: "700", color: "#1B2A4A" },
  text: { fontSize: 13, color: "#374151", marginTop: 4, lineHeight: 18 },
  verified: { fontSize: 11, fontWeight: "700", color: "#166534", marginTop: 4 },
});
