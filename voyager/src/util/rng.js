// Small seeded RNG so a voyage is reproducible from a seed (mulberry32).
export function makeRng(seed = 1) {
  let a = seed >>> 0;
  const rng = () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  rng.int = (n) => Math.floor(rng() * n);
  rng.pick = (arr) => arr[Math.floor(rng() * arr.length)];
  rng.chance = (p) => rng() < p;
  rng.range = (lo, hi) => lo + rng() * (hi - lo);
  // Weighted pick: items = [{ weight, ...}], returns the chosen item.
  rng.weighted = (items) => {
    const total = items.reduce((s, i) => s + Math.max(0, i.weight || 0), 0);
    if (total <= 0) return null;
    let r = rng() * total;
    for (const it of items) { r -= Math.max(0, it.weight || 0); if (r <= 0) return it; }
    return items[items.length - 1];
  };
  return rng;
}

export function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
