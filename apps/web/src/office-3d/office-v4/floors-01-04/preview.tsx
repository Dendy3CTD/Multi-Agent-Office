import { createRoot } from 'react-dom/client'
import OfficeScene3D from '../../OfficeScene3D'
import { officeV4ToWorldFloorId } from '../floor-id-adapter'
import { FLOOR_01_TO_04_PRESETS } from './index'

declare global {
  interface Window {
    __OFFICE_V4_PREVIEW__?: { status: 'loading' | 'ready' | 'error'; floorId: string; errors: string[] }
  }
}

const selectedNumber = Number(new URLSearchParams(window.location.search).get('floor') ?? '1')
const preset = FLOOR_01_TO_04_PRESETS[selectedNumber - 1]
const status: NonNullable<Window['__OFFICE_V4_PREVIEW__']> = { status: 'loading', floorId: preset?.floorId ?? 'missing', errors: [] }
window.__OFFICE_V4_PREVIEW__ = status

if (!preset) {
  status.status = 'error'
  status.errors.push(`unknown_floor:${selectedNumber}`)
} else {
  const worldFloorId = officeV4ToWorldFloorId(preset.floorId)
  const professionId = preset.specialization === 'management'
    ? 'project-manager'
    : preset.specialization === 'software-development'
      ? 'developer'
      : preset.specialization === 'quality-assurance'
        ? 'qa-engineer'
        : 'receptionist'
  const employees = preset.workplaces.flatMap((workplace, index) => workplace.employeeId ? [{
    employeeId: workplace.employeeId,
    displayName: workplace.employeeId,
    departmentId: preset.specialization ?? 'lobby',
    professionId,
    floorId: worldFloorId,
    deskId: workplace.deskId ?? workplace.id,
    x: workplace.x,
    y: workplace.z,
    active: true,
    status: 'idle' as const,
    characterVariant: index % 8,
  }] : [])

  createRoot(document.getElementById('root')!).render(
    <OfficeScene3D
      employees={employees}
      floorPreset={preset}
      visualProfile={`office-v4-floor-${String(selectedNumber).padStart(2, '0')}`}
      onSceneStatusChange={next => {
        status.status = next
        window.__OFFICE_V4_PREVIEW__ = status
      }}
      onRuntimeMetrics={metrics => {
        const mount = document.querySelector('.office-scene-3d-mount')
        if (mount) mount.setAttribute('data-preview-draw-calls', String(metrics.drawCalls))
      }}
    />,
  )
}
