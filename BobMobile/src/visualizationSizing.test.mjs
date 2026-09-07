import test from 'node:test'
import assert from 'node:assert/strict'

import { updateVisualHeightFromEvent, visualHeightFromMessage } from './visualizationSizing.ts'

test('reads a visualization height before React Native releases the WebView event', () => {
  const event = {
    nativeEvent: {
      data: JSON.stringify({ type: 'bob-visual-size', height: 321.2 }),
    },
  }
  let queuedUpdate

  updateVisualHeightFromEvent(event, update => { queuedUpdate = update })
  event.nativeEvent = null

  assert.equal(queuedUpdate(210), 322)
})

test('keeps the previous height for null, malformed or unrelated messages', () => {
  assert.equal(visualHeightFromMessage(null, 210), 210)
  assert.equal(visualHeightFromMessage('{', 210), 210)
  assert.equal(visualHeightFromMessage(JSON.stringify({ type: 'other', height: 500 }), 210), 210)
})
