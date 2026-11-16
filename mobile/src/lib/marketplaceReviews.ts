export function starString(score: number): string {
  const filled = Math.min(5, Math.max(0, Math.round(score)));
  return "★".repeat(filled) + "☆".repeat(5 - filled);
}

/** Each star level's share of all reviews, as a whole percentage (0 when there are no reviews). */
export function distributionPercents(distribution: Record<string, number>, count: number): Record<number, number> {
  const result: Record<number, number> = {};
  for (let score = 1; score <= 5; score += 1) {
    result[score] = count > 0 ? Math.round(((distribution[String(score)] ?? 0) / count) * 100) : 0;
  }
  return result;
}

export const MAX_REVIEW_LENGTH = 2000;
