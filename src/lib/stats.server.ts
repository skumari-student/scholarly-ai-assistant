// Server-only deterministic statistics helpers for Data Lab.
// Kept in pure JS to avoid extra deps and to run inside the Worker runtime.

export interface Descriptive {
  column: string;
  n: number;
  missing: number;
  mean: number | null;
  median: number | null;
  sd: number | null;
  min: number | null;
  max: number | null;
  q1: number | null;
  q3: number | null;
}

function toNumbers(values: unknown[]): { nums: number[]; missing: number } {
  const nums: number[] = [];
  let missing = 0;
  for (const v of values) {
    if (v === "" || v == null) { missing++; continue; }
    const n = typeof v === "number" ? v : Number(String(v).replace(/[,%$\s]/g, ""));
    if (Number.isFinite(n)) nums.push(n); else missing++;
  }
  return { nums, missing };
}

function quantile(sorted: number[], q: number): number | null {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  const next = sorted[base + 1];
  return next != null ? sorted[base] + rest * (next - sorted[base]) : sorted[base];
}

export function describe(column: string, values: unknown[]): Descriptive {
  const { nums, missing } = toNumbers(values);
  if (!nums.length) {
    return { column, n: 0, missing, mean: null, median: null, sd: null, min: null, max: null, q1: null, q3: null };
  }
  const sorted = [...nums].sort((a, b) => a - b);
  const mean = nums.reduce((s, n) => s + n, 0) / nums.length;
  const variance = nums.reduce((s, n) => s + (n - mean) ** 2, 0) / Math.max(1, nums.length - 1);
  return {
    column,
    n: nums.length,
    missing,
    mean,
    median: quantile(sorted, 0.5),
    sd: Math.sqrt(variance),
    min: sorted[0],
    max: sorted[sorted.length - 1],
    q1: quantile(sorted, 0.25),
    q3: quantile(sorted, 0.75),
  };
}

export function isNumericColumn(values: unknown[]): boolean {
  const { nums } = toNumbers(values);
  return nums.length >= Math.max(3, Math.floor(values.length * 0.6));
}

export function columnAt(rows: unknown[][], index: number): unknown[] {
  return rows.map((r) => r[index]);
}

// Pearson correlation matrix for numeric columns.
export function correlationMatrix(columns: string[], rows: unknown[][]): { labels: string[]; matrix: number[][] } {
  const cols = columns
    .map((c, i) => ({ c, i, values: columnAt(rows, i) }))
    .filter((x) => isNumericColumn(x.values));
  const labels = cols.map((c) => c.c);
  const numeric = cols.map((c) => toNumbers(c.values).nums);
  const matrix: number[][] = labels.map(() => labels.map(() => 0));
  for (let a = 0; a < numeric.length; a++) {
    for (let b = 0; b < numeric.length; b++) {
      matrix[a][b] = a === b ? 1 : pearson(numeric[a], numeric[b]);
    }
  }
  return { labels, matrix };
}

function pearson(x: number[], y: number[]): number {
  const n = Math.min(x.length, y.length);
  if (n < 2) return 0;
  const xm = x.slice(0, n).reduce((s, v) => s + v, 0) / n;
  const ym = y.slice(0, n).reduce((s, v) => s + v, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    const a = x[i] - xm, b = y[i] - ym;
    num += a * b; dx += a * a; dy += b * b;
  }
  const denom = Math.sqrt(dx * dy);
  return denom ? +(num / denom).toFixed(4) : 0;
}

// Welch's t-test (two-sample, unequal variance). Returns t, df, and a two-sided p-value approximation.
export function tTest(a: number[], b: number[]): { t: number; df: number; p: number; meanA: number; meanB: number; nA: number; nB: number } {
  const nA = a.length, nB = b.length;
  const meanA = a.reduce((s, v) => s + v, 0) / nA;
  const meanB = b.reduce((s, v) => s + v, 0) / nB;
  const varA = a.reduce((s, v) => s + (v - meanA) ** 2, 0) / Math.max(1, nA - 1);
  const varB = b.reduce((s, v) => s + (v - meanB) ** 2, 0) / Math.max(1, nB - 1);
  const se = Math.sqrt(varA / nA + varB / nB) || 1e-12;
  const t = (meanA - meanB) / se;
  const df = (varA / nA + varB / nB) ** 2 /
    ((varA / nA) ** 2 / Math.max(1, nA - 1) + (varB / nB) ** 2 / Math.max(1, nB - 1));
  return { t: +t.toFixed(4), df: +df.toFixed(2), p: +approxPTwoSided(t, df).toFixed(4), meanA, meanB, nA, nB };
}

// Rough two-sided p-value via a normal approximation to t (adequate for df >= 20).
function approxPTwoSided(t: number, df: number): number {
  const x = Math.abs(t);
  // Abramowitz & Stegun approximation for standard normal CDF.
  const cdf = 0.5 * (1 + erf(x / Math.SQRT2));
  const p = 2 * (1 - cdf);
  // Very small df correction: inflate p a little.
  if (df < 15) return Math.min(1, p * 1.15);
  return p;
}
function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429, pC = 0.3275911;
  const tt = 1 / (1 + pC * ax);
  const y = 1 - (((((a5 * tt + a4) * tt) + a3) * tt + a2) * tt + a1) * tt * Math.exp(-ax * ax);
  return sign * y;
}

// Simple linear regression y = a + b*x. Returns slope, intercept, r2.
export function linreg(x: number[], y: number[]): { slope: number; intercept: number; r2: number; n: number } {
  const n = Math.min(x.length, y.length);
  const xm = x.slice(0, n).reduce((s, v) => s + v, 0) / n;
  const ym = y.slice(0, n).reduce((s, v) => s + v, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { num += (x[i] - xm) * (y[i] - ym); den += (x[i] - xm) ** 2; }
  const slope = den ? num / den : 0;
  const intercept = ym - slope * xm;
  let ssTot = 0, ssRes = 0;
  for (let i = 0; i < n; i++) {
    ssTot += (y[i] - ym) ** 2;
    const pred = intercept + slope * x[i];
    ssRes += (y[i] - pred) ** 2;
  }
  const r2 = ssTot ? 1 - ssRes / ssTot : 0;
  return { slope: +slope.toFixed(4), intercept: +intercept.toFixed(4), r2: +r2.toFixed(4), n };
}

export function frequency(values: unknown[], top = 15): Array<{ label: string; count: number }> {
  const map = new Map<string, number>();
  for (const v of values) {
    const key = v === "" || v == null ? "(missing)" : String(v);
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, top)
    .map(([label, count]) => ({ label, count }));
}

export function toNumericColumn(values: unknown[]): number[] {
  return toNumbers(values).nums;
}
