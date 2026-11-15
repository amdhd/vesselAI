/**
 * Dusk tokens for places a Tailwind class cannot reach: chart props, Leaflet
 * path options and HTML strings. Values point at the CSS custom properties
 * in src/styles/tokens.css, so the stylesheet stays the single source.
 */
export type Token =
  | 'shade' | 'paper' | 'paper-2' | 'paper-3' | 'rule' | 'rule-2'
  | 'ink' | 'ink-2' | 'muted' | 'faint' | 'faint-2' | 'light'
  | 'accent' | 'accent-hi' | 'accent-deep' | 'accent-soft' | 'accent-ink'
  | 'apricot' | 'apricot-deep' | 'critical' | 'critical-deep'

/**
 * A token as a CSS colour string, optionally with alpha (0–1). It resolves in
 * the browser through the custom property, so it works in style objects, SVG
 * presentation attributes (Recharts, Leaflet paths) and HTML strings alike.
 */
export function tok(name: Token, alpha?: number): string {
  return alpha === undefined ? `oklch(var(--c-${name}))` : `oklch(var(--c-${name}) / ${alpha})`
}

/** Shared Recharts styling so every chart reads as one system. */
export function chartTheme() {
  return {
    grid: tok('light', 0.06),
    axis: tok('rule'),
    tick: { fill: tok('muted'), fontSize: 11 },
    tooltip: {
      contentStyle: {
        backgroundColor: tok('paper-2'),
        border: `1px solid ${tok('light', 0.08)}`,
        borderRadius: '10px',
        boxShadow: 'var(--shadow-pop)',
        fontSize: '12px',
        color: tok('ink'),
      },
      labelStyle: { color: tok('ink-2') },
      itemStyle: { color: tok('ink') },
      cursor: { stroke: tok('light', 0.12) },
    },
    legend: { fontSize: '12px', color: tok('ink-2') },
  }
}
