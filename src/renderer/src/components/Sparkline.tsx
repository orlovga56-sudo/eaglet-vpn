interface SparklineProps {
  values: number[]
  className?: string
  height?: number
  width?: number
  filled?: boolean
}

/** Tiny smooth sparkline built from a numeric series. */
export function Sparkline({
  values,
  className,
  height = 26,
  width = 60,
  filled = false
}: SparklineProps): React.JSX.Element {
  const data = values.length > 1 ? values : [0, 0, 0, 0]
  const max = Math.max(...data, 1)
  const min = Math.min(...data, 0)
  const span = max - min || 1
  const step = width / (data.length - 1)

  const points = data.map((value, index) => {
    const x = index * step
    const y = height - 3 - ((value - min) / span) * (height - 6)
    return [x, y] as const
  })

  const line = points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ')
  const area = `${line} L${width} ${height} L0 ${height} Z`
  const gradientId = `spark-${filled ? 'fill' : 'line'}-${width}-${height}`

  return (
    <svg className={className} width={width} height={height} viewBox={`0 0 ${width} ${height}`} fill="none">
      {filled && (
        <>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="currentColor" stopOpacity="0.35" />
              <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={area} fill={`url(#${gradientId})`} />
        </>
      )}
      <path d={line} stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
