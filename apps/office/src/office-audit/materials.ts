import { createAuditReport } from './report'
import type { AuditFinding, MaterialsLibraryAudit } from './types'

function fail(code: string, description: string, file: string, recommendation: string): AuditFinding {
  return { code, severity: 'FAIL', description, file, recommendation, category: 'validator' }
}

function unitInterval(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
}

export function validateMaterialsLibrary(value: unknown, file = 'materials.json'): MaterialsLibraryAudit {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { report: createAuditReport([fail('MATERIALS_ROOT_INVALID', 'Material library must be a JSON object.', file, 'Regenerate a valid material library.')]), materialCount: 0 }
  }
  const root = value as Record<string, unknown>
  const findings: AuditFinding[] = []
  if (root.version !== 1 && root.version !== 2) findings.push(fail('MATERIALS_VERSION_UNSUPPORTED', `Expected material library version 1 or 2, received ${String(root.version)}.`, file, 'Export a supported material-library format.'))
  if (typeof root.units !== 'string' || root.units.length === 0) findings.push(fail('MATERIALS_UNITS_MISSING', 'Material color-space units are missing.', file, 'Declare the material color space.'))
  if (typeof root.materials !== 'object' || root.materials === null || Array.isArray(root.materials)) {
    findings.push(fail('MATERIALS_MAP_INVALID', 'materials must be an object keyed by stable material name.', file, 'Provide a named material map.'))
    return { report: createAuditReport(findings), materialCount: 0 }
  }

  const entries = Object.entries(root.materials as Record<string, unknown>)
  for (const [name, rawMaterial] of entries) {
    const asset = `${file}#${name}`
    if (typeof rawMaterial !== 'object' || rawMaterial === null || Array.isArray(rawMaterial)) {
      findings.push({ ...fail('MATERIAL_INVALID', 'Material entry must be an object.', file, 'Provide valid PBR material properties.'), asset })
      continue
    }
    const material = rawMaterial as Record<string, unknown>
    if (!Array.isArray(material.baseColorFactor) || material.baseColorFactor.length !== 4 || !material.baseColorFactor.every(unitInterval)) {
      findings.push({ ...fail('MATERIAL_BASE_COLOR_INVALID', 'baseColorFactor must contain four finite values from 0 to 1.', file, 'Correct the linear RGBA color factor.'), asset })
    }
    if (!unitInterval(material.roughness)) findings.push({ ...fail('MATERIAL_ROUGHNESS_INVALID', 'roughness must be between 0 and 1.', file, 'Clamp roughness to the PBR range.'), asset })
    if (!unitInterval(material.metallic)) findings.push({ ...fail('MATERIAL_METALLIC_INVALID', 'metallic must be between 0 and 1.', file, 'Clamp metallic to the PBR range.'), asset })
    if (material.baseColorTexture !== undefined) {
      const texture = material.baseColorTexture
      if (typeof texture !== 'object' || texture === null || Array.isArray(texture) || typeof (texture as Record<string, unknown>).url !== 'string') {
        findings.push({ ...fail('MATERIAL_TEXTURE_INVALID', 'baseColorTexture must contain a URL.', file, 'Provide a valid texture descriptor with a stable URL.'), asset })
      }
    }
  }
  return { report: createAuditReport(findings), materialCount: entries.length }
}
