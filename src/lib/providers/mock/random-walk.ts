/** Small deterministic-ish random walk helpers shared by mock providers. */

export function randomWalkStep(current: number, volatilityPct: number, driftPct = 0): number {
  const shock = (Math.random() * 2 - 1) * volatilityPct + driftPct;
  return Math.max(0, current * (1 + shock / 100));
}

export function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

export function pickWeighted<T>(items: T[], weights: number[]): T {
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}
