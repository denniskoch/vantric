import { useEffect, useMemo, useRef, useState } from 'react'
import { Box, Paper, Typography } from '@mui/material'
import { chart } from '../chartPalette'

export interface Series {
  name: string
  color: string
  /** values aligned with the shared `times` array */
  values: number[]
}

interface Props {
  title: string
  times: number[] // unix seconds
  series: Series[]
  /** formats y values for axis ticks and the tooltip */
  format: (value: number) => string
  /** force the y axis to this maximum (e.g. a memory limit) */
  yMax?: number
  /**
   * Lowest allowed auto-scaled maximum. Keeps a near-idle series from
   * being amplified into dramatic-looking noise.
   */
  minYMax?: number
  height?: number
}

const PAD = { top: 8, right: 12, bottom: 22, left: 62 }

/**
 * Small dependency-free time-series chart: 2px lines, an area fill when
 * there's a single series, recessive grid, and a crosshair + tooltip.
 */
export default function TimeSeriesChart({
  title,
  times,
  series,
  format,
  yMax,
  minYMax,
  height = 168,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(600)
  const [hover, setHover] = useState<number | null>(null)

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => {
      setWidth(entry.contentRect.width)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const { max, ticks } = useMemo(() => {
    const dataMax = Math.max(
      1,
      ...series.flatMap((s) => s.values.filter((v) => Number.isFinite(v))),
    )
    const top = yMax ?? Math.max(niceCeil(dataMax), minYMax ?? 0)
    return { max: top, ticks: [0, top / 2, top] }
  }, [series, yMax, minYMax])

  const plotW = Math.max(1, width - PAD.left - PAD.right)
  const plotH = height - PAD.top - PAD.bottom
  const x = (i: number) =>
    PAD.left + (times.length <= 1 ? plotW / 2 : (i / (times.length - 1)) * plotW)
  const y = (v: number) => PAD.top + plotH - (Math.min(v, max) / max) * plotH

  const linePath = (values: number[]) =>
    values
      .map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`)
      .join(' ')

  const areaPath = (values: number[]) =>
    values.length
      ? `${linePath(values)} L${x(values.length - 1).toFixed(1)},${(PAD.top + plotH).toFixed(1)} L${x(0).toFixed(1)},${(PAD.top + plotH).toFixed(1)} Z`
      : ''

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const px = e.clientX - rect.left
    if (times.length < 2) return setHover(null)
    const ratio = (px - PAD.left) / plotW
    const idx = Math.round(ratio * (times.length - 1))
    setHover(idx >= 0 && idx < times.length ? idx : null)
  }

  const xLabelCount = Math.min(5, times.length)
  const xLabels = Array.from({ length: xLabelCount }, (_, i) => {
    const idx = Math.round((i / Math.max(1, xLabelCount - 1)) * (times.length - 1))
    return { idx, label: timeLabel(times[idx], times) }
  })

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 2, mb: 1 }}>
        <Typography variant="body2" sx={{ fontWeight: 500 }}>
          {title}
        </Typography>
        {series.length > 1 && (
          <Box sx={{ display: 'flex', gap: 1.5 }}>
            {series.map((s) => (
              <Box key={s.name} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <Box
                  sx={{ width: 8, height: 8, borderRadius: '2px', bgcolor: s.color }}
                />
                <Typography sx={{ fontSize: 11, color: chart.secondary }}>
                  {s.name}
                </Typography>
              </Box>
            ))}
          </Box>
        )}
      </Box>

      <Box ref={wrapRef} sx={{ position: 'relative' }}>
        <svg
          width="100%"
          height={height}
          onMouseMove={onMove}
          onMouseLeave={() => setHover(null)}
          style={{ display: 'block', overflow: 'visible' }}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line
                x1={PAD.left}
                x2={PAD.left + plotW}
                y1={y(t)}
                y2={y(t)}
                stroke={t === 0 ? chart.axis : chart.grid}
                strokeWidth={1}
              />
              <text
                x={PAD.left - 8}
                y={y(t) + 3}
                textAnchor="end"
                fontSize={10}
                fill={chart.muted}
                style={{ fontVariantNumeric: 'tabular-nums' }}
              >
                {format(t)}
              </text>
            </g>
          ))}

          {xLabels.map(({ idx, label }, i) => (
            <text
              key={`${idx}-${i}`}
              x={x(idx)}
              y={height - 6}
              textAnchor={i === 0 ? 'start' : i === xLabels.length - 1 ? 'end' : 'middle'}
              fontSize={10}
              fill={chart.muted}
            >
              {label}
            </text>
          ))}

          {series.length === 1 && (
            <path d={areaPath(series[0].values)} fill={series[0].color} opacity={0.12} />
          )}
          {series.map((s) => (
            <path
              key={s.name}
              d={linePath(s.values)}
              fill="none"
              stroke={s.color}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ))}

          {hover !== null && (
            <>
              <line
                x1={x(hover)}
                x2={x(hover)}
                y1={PAD.top}
                y2={PAD.top + plotH}
                stroke={chart.axis}
                strokeWidth={1}
              />
              {series.map((s) => (
                <circle
                  key={s.name}
                  cx={x(hover)}
                  cy={y(s.values[hover] ?? 0)}
                  r={4}
                  fill={s.color}
                  stroke={chart.surface}
                  strokeWidth={2}
                />
              ))}
            </>
          )}
        </svg>

        {hover !== null && (
          <Box
            sx={{
              position: 'absolute',
              top: 0,
              left: Math.min(Math.max(x(hover) + 12, 0), Math.max(0, width - 190)),
              pointerEvents: 'none',
              bgcolor: '#fff',
              border: '1px solid #dadce0',
              borderRadius: 1,
              boxShadow: '0 1px 3px rgba(60,64,67,0.3)',
              px: 1.2,
              py: 0.8,
              minWidth: 150,
            }}
          >
            <Typography sx={{ fontSize: 11, color: chart.muted, mb: 0.4 }}>
              {new Date(times[hover] * 1000).toLocaleString()}
            </Typography>
            {series.map((s) => (
              <Box
                key={s.name}
                sx={{ display: 'flex', alignItems: 'center', gap: 0.8, fontSize: 12 }}
              >
                <Box sx={{ width: 8, height: 8, borderRadius: '2px', bgcolor: s.color }} />
                <span style={{ color: chart.secondary }}>{s.name}</span>
                <span
                  style={{
                    marginLeft: 'auto',
                    fontVariantNumeric: 'tabular-nums',
                    color: '#202124',
                  }}
                >
                  {format(s.values[hover] ?? 0)}
                </span>
              </Box>
            ))}
          </Box>
        )}
      </Box>
    </Paper>
  )
}

function niceCeil(value: number): number {
  const magnitude = 10 ** Math.floor(Math.log10(value))
  return Math.ceil(value / magnitude) * magnitude
}

// Short labels within a day, dates for longer spans.
function timeLabel(t: number, times: number[]): string {
  const span = (times[times.length - 1] ?? 0) - (times[0] ?? 0)
  const d = new Date(t * 1000)
  if (span <= 86400) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}
