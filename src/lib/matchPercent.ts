// PGVectorStore returns cosine distance (0 = identical, higher = less similar),
// not a similarity score, so it must be inverted before displaying as "% match".
export function toMatchPercent(distance: number): number {
  const similarity = 1 - distance;
  return Math.round(Math.max(0, Math.min(1, similarity)) * 100);
}
