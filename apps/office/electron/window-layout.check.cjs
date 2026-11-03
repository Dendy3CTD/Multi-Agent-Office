const test = require('node:test')
const assert = require('node:assert/strict')
const { initialContentSize, SCENE_WIDTH, SCENE_HEIGHT } = require('./window-layout.cjs')

test('large work area uses the source scene content size', () => {
  const size = initialContentSize({ width: 2560, height: 1440 })
  assert.deepEqual(size, { width: SCENE_WIDTH, height: SCENE_HEIGHT })
})

test('small work area scales content without changing scene proportions', () => {
  const size = initialContentSize({ width: 1280, height: 720 })
  assert.ok(size.width < SCENE_WIDTH)
  assert.ok(size.height < SCENE_HEIGHT)
  assert.ok(Math.abs(size.width / size.height - SCENE_WIDTH / SCENE_HEIGHT) < 0.002)
  assert.ok(size.height + 40 + 16 <= 720)
})

test('minimum content size remains wide enough for the whole room', () => {
  const size = initialContentSize({ width: 800, height: 600 })
  assert.deepEqual(size, { width: 1000, height: 563 })
})
