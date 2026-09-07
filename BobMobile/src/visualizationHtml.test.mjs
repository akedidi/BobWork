import test from 'node:test'
import assert from 'node:assert/strict'

import { isAllowedVisualizationRequest, safeVisualizationHtml, visualizationScrollScript } from './visualizationHtml.ts'

test('blocks page networking except supported visualization script CDNs', () => {
  const html = safeVisualizationHtml('<html><head><title>Chart</title></head><body></body></html>')
  assert.match(html, /default-src 'none'/)
  assert.match(html, /connect-src 'none'/)
  assert.match(html, /script-src 'unsafe-inline' https:\/\/cdn\.jsdelivr\.net https:\/\/cdn\.plot\.ly https:\/\/unpkg\.com/)
  assert.ok(html.indexOf('Content-Security-Policy') < html.indexOf('<title>'))
})

test('wraps HTML fragments with the same security policy', () => {
  const html = safeVisualizationHtml('<main>Preview</main>')
  assert.match(html, /^<!doctype html><html><head>/)
  assert.match(html, /<body><main>Preview<\/main><\/body><\/html>$/)
})

test('scroll setup enables a desktop-sized two-axis viewport without scaling', () => {
  assert.match(visualizationScrollScript, /overflow = 'auto'/)
  assert.match(visualizationScrollScript, /minWidth = '900px'/)
  assert.doesNotMatch(visualizationScrollScript, /scale\(/)
  assert.doesNotMatch(visualizationScrollScript, /postMessage/)
})

test('only the document and trusted rendering CDNs are accepted', () => {
  assert.equal(isAllowedVisualizationRequest('about:blank'), true)
  assert.equal(isAllowedVisualizationRequest('about:blank#section'), true)
  assert.equal(isAllowedVisualizationRequest('https://cdn.jsdelivr.net/npm/three/build/three.min.js'), true)
  assert.equal(isAllowedVisualizationRequest('https://cdn.plot.ly/plotly.min.js'), true)
  assert.equal(isAllowedVisualizationRequest('https://unpkg.com/three/build/three.min.js'), true)
  assert.equal(isAllowedVisualizationRequest('https://example.com/tracker.js'), false)
  assert.equal(isAllowedVisualizationRequest('https://cdn.jsdelivr.net.evil.example/script.js'), false)
})
