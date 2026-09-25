// Two-handle slider over a reject / review / pass zone bar. Each handle is a native range input (keyboard + screen reader).
const THUMB =
  'pointer-events-none absolute inset-0 h-5 w-full appearance-none bg-transparent outline-none ' +
  '[&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:size-4 [&::-webkit-slider-thumb]:cursor-grab [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-background [&::-webkit-slider-thumb]:shadow ' +
  '[&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:size-4 [&::-moz-range-thumb]:cursor-grab [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-background ' +
  'focus-visible:[&::-webkit-slider-thumb]:ring-3 focus-visible:[&::-webkit-slider-thumb]:ring-ring/60 disabled:opacity-50'

export function ThresholdSlider({
  reject,
  pass,
  onChange,
  disabled,
  phaseLabel,
}: {
  reject: number
  pass: number
  onChange: (reject: number, pass: number) => void
  disabled?: boolean
  phaseLabel: string
}) {
  const r = Math.max(0, Math.min(100, reject))
  const p = Math.max(0, Math.min(100, pass))
  return (
    <div className="relative h-5">
      <div className="absolute inset-x-0 top-1/2 flex h-2 -translate-y-1/2 overflow-hidden rounded-full" aria-hidden>
        <div className="bg-red-400/80 dark:bg-red-500/60" style={{ width: `${r}%` }} />
        <div className="bg-amber-300/90 dark:bg-amber-500/60" style={{ width: `${Math.max(0, p - r)}%` }} />
        <div className="flex-1 bg-green-400/80 dark:bg-green-500/60" />
      </div>
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={r}
        disabled={disabled}
        aria-label={`${phaseLabel} Auto-Reject (slider)`}
        onChange={(e) => onChange(Math.min(Number(e.target.value), p - 1), p)}
        className={`${THUMB} [&::-moz-range-thumb]:bg-red-600 [&::-webkit-slider-thumb]:bg-red-600`}
      />
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={p}
        disabled={disabled}
        aria-label={`${phaseLabel} Auto-Pass (slider)`}
        onChange={(e) => onChange(r, Math.max(Number(e.target.value), r + 1))}
        className={`${THUMB} [&::-moz-range-thumb]:bg-green-600 [&::-webkit-slider-thumb]:bg-green-600`}
      />
    </div>
  )
}
