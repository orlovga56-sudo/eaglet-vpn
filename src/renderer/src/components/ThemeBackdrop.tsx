import type { ThemeId } from '@shared/types'

/** Decorative, theme-specific background layers. Purely CSS/SVG. */
export function ThemeBackdrop({ theme }: { theme: ThemeId }): React.JSX.Element {
  return (
    <div className="backdrop">
      {theme === 'cyber' && (
        <>
          <svg className="bolt bolt--left" width="340" height="100%" viewBox="0 0 340 900" preserveAspectRatio="none">
            <defs>
              <linearGradient id="boltGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#7dd3fc" stopOpacity="0" />
                <stop offset="35%" stopColor="#38bdf8" stopOpacity="0.9" />
                <stop offset="100%" stopColor="#22d3ee" stopOpacity="0" />
              </linearGradient>
            </defs>
            <path
              d="M300 40 210 250l62 18-96 220 70 14-112 280"
              fill="none"
              stroke="url(#boltGrad)"
              strokeWidth="2"
            />
            <path
              d="M282 120 214 292l48 10-74 180"
              fill="none"
              stroke="url(#boltGrad)"
              strokeWidth="1"
              opacity="0.6"
            />
          </svg>
          <svg className="bolt bolt--right" width="300" height="100%" viewBox="0 0 300 900" preserveAspectRatio="none">
            <path
              d="M60 100 170 320l-58 16 92 200-64 20 92 240"
              fill="none"
              stroke="url(#boltGrad)"
              strokeWidth="1.6"
            />
          </svg>
        </>
      )}

      {theme === 'glass' && (
        <>
          <div className="blob blob--1" />
          <div className="blob blob--2" />
          <div className="blob blob--3" />
        </>
      )}

      {theme === 'aurora' && (
        <>
          <div className="ribbon ribbon--1" />
          <div className="ribbon ribbon--2" />
          <div className="ribbon ribbon--3" />
        </>
      )}
    </div>
  )
}
