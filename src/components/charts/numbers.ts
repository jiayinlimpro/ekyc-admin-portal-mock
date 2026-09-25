// Number formatting for charts and stat tiles (Malaysian English grouping).
export const fmtInt = (n: number) => n.toLocaleString('en-MY')
export const fmtPct = (n: number, d = 1) => `${Number.isFinite(n) ? n.toFixed(d) : '0.0'}%`
export const pct = (part: number, whole: number) => (whole ? (100 * part) / whole : 0)
