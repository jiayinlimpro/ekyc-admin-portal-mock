// REQ: DEC-19 — layout of the band bar's threshold numbers (pure, unit-tested).

/** Where the two threshold numbers sit under the bar (% of its width): centred on their mark, pushed apart and kept
 *  inside the bar when they would overlap (e.g. High: 90 and 97). */
export function labelPositions(autoReject: number, autoPass: number, minGap = 8, edge = 3): [number, number] {
  let a = Math.max(autoReject, edge)
  let b = Math.min(autoPass, 100 - edge)
  if (b - a < minGap) {
    const mid = Math.min(Math.max((a + b) / 2, edge + minGap / 2), 100 - edge - minGap / 2)
    a = mid - minGap / 2
    b = mid + minGap / 2
  }
  return [a, b]
}
