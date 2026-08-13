// Chart tokens. The two categorical slots are validated for CVD safety
// against the white chart surface (worst adjacent ΔE 30.2 protan /
// 37.3 normal vision, contrast ≥ 3:1). Re-run the palette validator if
// these change, or when a dark surface is introduced.
export const chart = {
  series: ['#1a73e8', '#e8710a'],
  grid: '#e8eaed',
  axis: '#dadce0',
  muted: '#80868b',
  secondary: '#5f6368',
  surface: '#ffffff',
} as const
