const SCENE_WIDTH = 1672
const SCENE_HEIGHT = 941
const SCENE_ASPECT = SCENE_WIDTH / SCENE_HEIGHT

function initialContentSize(workAreaSize, titleBarHeight = 40, margin = 8) {
  const availableWidth = Math.max(1000, workAreaSize.width - margin * 2)
  const availableHeight = Math.max(563, workAreaSize.height - titleBarHeight - margin * 2)
  const scale = Math.min(1, availableWidth / SCENE_WIDTH, availableHeight / SCENE_HEIGHT)
  return { width: Math.round(SCENE_WIDTH * scale), height: Math.round(SCENE_HEIGHT * scale) }
}

module.exports = { SCENE_WIDTH, SCENE_HEIGHT, SCENE_ASPECT, initialContentSize }
