import { describe, expect, it } from 'vitest'
import { calculateFittedFrameLayout, isCanvasFrameSource, withLocalThreeRuntime } from './FittedHtmlFrame'

describe('calculateFittedFrameLayout', () => {
  it.each([
    ['conversation', 'inline' as const, { width: 720, height: 480 }],
    ['preview', 'panel' as const, { width: 520, height: 700 }],
  ])('active le scroll pour un dashboard long dans la %s', (_label, mode, viewport) => {
    const layout = calculateFittedFrameLayout({ width: 960, height: 1_600 }, viewport, mode)

    expect(layout.scale).toBeCloseTo(viewport.width / 960)
    expect(layout.shouldScroll).toBe(true)
    expect(layout.frameHeight).toBe(layout.targetHeight)
  })

  it('réduit modérément un visuel pour tenir entièrement dans la conversation', () => {
    const layout = calculateFittedFrameLayout(
      { width: 720, height: 680 },
      { width: 720, height: 480 },
      'inline',
    )

    expect(layout.scale).toBeCloseTo(layout.targetHeight / 680)
    expect(layout.scale).toBeGreaterThanOrEqual(0.68)
    expect(layout.shouldScroll).toBe(false)
    expect(layout.frameHeight).toBeLessThanOrEqual(layout.targetHeight + 1)
  })

  it('conserve le scroll plutôt que de rendre une longue page illisible', () => {
    const layout = calculateFittedFrameLayout(
      { width: 720, height: 1_800 },
      { width: 720, height: 480 },
      'inline',
    )

    expect(layout.scale).toBe(1)
    expect(layout.shouldScroll).toBe(true)
  })

  it.each([
    ['inline' as const, { width: 720, height: 480 }],
    ['panel' as const, { width: 520, height: 700 }],
  ])('n’ajoute pas de scroll quand toute la page tient dans le mode %s', (mode, viewport) => {
    const layout = calculateFittedFrameLayout({ width: 500, height: 300 }, viewport, mode)

    expect(layout.shouldScroll).toBe(false)
    expect(layout.frameHeight).toBe(300)
  })

  it('remplace les CDN Three.js et ECharts par le bridge local embarqué', () => {
    const source = '<html><head><script src="https://cdn.jsdelivr.net/npm/three@0.185.1/build/three.min.js"></script><script src="https://cdn.jsdelivr.net/npm/echarts@6.1.0/dist/echarts.min.js"></script></head><body></body></html>'
    const result = withLocalThreeRuntime(source, 'window.THREE={};window.echarts={};')

    expect(result).not.toContain('cdn.jsdelivr.net')
    expect(result).toContain('window.THREE={};window.echarts={};')
    expect(result.indexOf('window.THREE')).toBeLessThan(result.indexOf('</head>'))
  })

  it('accepte les événements DOM des deux versions du diff visuel', () => {
    const current = {} as Window
    const previous = {} as Window

    expect(isCanvasFrameSource(current, current, previous)).toBe(true)
    expect(isCanvasFrameSource(previous, current, previous)).toBe(true)
    expect(isCanvasFrameSource({} as Window, current, previous)).toBe(false)
    expect(isCanvasFrameSource(null, current, previous)).toBe(false)
  })
})
