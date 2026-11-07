import { createAuditReport } from './report'
import { extensionOf, isSafeLocalPath } from './paths'
import type {
  AssetManifest,
  AssetManifestRecord,
  AuditFinding,
  AuditReport,
  ManifestValidationOptions,
} from './types'

export const DEFAULT_SUPPORTED_ASSET_EXTENSIONS = [
  '.glb', '.gltf', '.bin', '.json', '.png', '.jpg', '.jpeg', '.webp', '.svg', '.ktx2', '.basis',
] as const

export const DEFAULT_ASSET_ANCHORS = [
  'bottom-center', 'floor-center', 'desk-top', 'wall-center', 'surface', 'center', 'origin',
] as const

function finding(
  code: string,
  severity: 'WARNING' | 'FAIL',
  description: string,
  recommendation: string,
  subject?: string,
): AuditFinding {
  return { code, severity, description, recommendation, subject }
}

function finiteVector3(value: unknown): value is readonly [number, number, number] {
  return Array.isArray(value) && value.length === 3 && value.every(item => typeof item === 'number' && Number.isFinite(item))
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

export function isAssetManifest(value: unknown): value is AssetManifest {
  return typeof value === 'object' && value !== null && Array.isArray((value as { assets?: unknown }).assets)
}

export function validateAssetManifest(
  manifest: unknown,
  options: ManifestValidationOptions = {},
): AuditReport {
  if (manifest === undefined || manifest === null) {
    return createAuditReport([finding(
      'MANIFEST_MISSING',
      'FAIL',
      'The asset manifest is not available.',
      'Create or load manifest.json before auditing the asset pack.',
      'manifest',
    )])
  }
  if (!isAssetManifest(manifest)) {
    return createAuditReport([finding(
      'MANIFEST_INVALID',
      'FAIL',
      'The manifest must be an object with an assets array.',
      'Validate the parsed JSON against the documented manifest shape.',
      'manifest',
    )])
  }

  const findings: AuditFinding[] = []
  const seenIds = new Set<string>()
  const supportedExtensions = new Set((options.supportedExtensions ?? DEFAULT_SUPPORTED_ASSET_EXTENSIONS).map(value => value.toLowerCase()))
  const allowedAnchors = new Set(options.allowedAnchors ?? DEFAULT_ASSET_ANCHORS)

  manifest.assets.forEach((rawAsset, index) => {
    if (typeof rawAsset !== 'object' || rawAsset === null || Array.isArray(rawAsset)) {
      findings.push(finding('ASSET_RECORD_INVALID', 'FAIL', 'Each asset record must be an object.', 'Replace the entry with a valid asset record.', `assets[${index}]`))
      return
    }
    const asset = rawAsset as Partial<AssetManifestRecord>
    const subject = nonEmptyString(asset.id) ? asset.id : `assets[${index}]`
    if (!nonEmptyString(asset.id)) {
      findings.push(finding('ASSET_ID_INVALID', 'FAIL', 'Asset id must be a non-empty string.', 'Assign a stable unique asset id.', subject))
    } else if (seenIds.has(asset.id)) {
      findings.push(finding('ASSET_ID_DUPLICATE', 'FAIL', `Asset id "${asset.id}" is duplicated.`, 'Make every asset id unique.', subject))
    } else {
      seenIds.add(asset.id)
    }

    if (!nonEmptyString(asset.url)) {
      findings.push(finding('ASSET_PATH_MISSING', 'FAIL', 'Asset URL is missing.', 'Provide a local path to the asset file.', subject))
    } else if (!isSafeLocalPath(asset.url)) {
      findings.push(finding('ASSET_PATH_UNSAFE', 'FAIL', `Asset path "${asset.url}" is not a safe local path.`, 'Use a pack-local relative or root-relative path without traversal, protocols, or backslashes.', subject))
    } else if (!supportedExtensions.has(extensionOf(asset.url))) {
      findings.push(finding('ASSET_FORMAT_UNSUPPORTED', 'FAIL', `Asset format "${extensionOf(asset.url) || '(none)'}" is unsupported.`, 'Use a supported model, texture, binary, or metadata format, or configure the allowlist.', subject))
    }

    if (asset.sizeBytes !== undefined && (
      typeof asset.sizeBytes !== 'number' || !Number.isSafeInteger(asset.sizeBytes) || asset.sizeBytes < 0
    )) {
      findings.push(finding('ASSET_SIZE_INVALID', 'FAIL', 'sizeBytes must be a non-negative safe integer when provided.', 'Record the exported file size in bytes or omit the optional field.', subject))
    }

    if (!finiteVector3(asset.bounds) || asset.bounds.some(value => value < 0)) {
      findings.push(finding('ASSET_BOUNDS_INVALID', 'FAIL', 'Bounds must contain three finite, non-negative dimensions.', 'Export reliable [x, y, z] dimensions in the declared coordinate system.', subject))
    } else if (asset.type !== 'material' && asset.bounds.every(value => value === 0)) {
      findings.push(finding('ASSET_BOUNDS_EMPTY', 'WARNING', 'A renderable asset reports zero size on every axis.', 'Recalculate bounds from the exported model.', subject))
    }
    if (typeof asset.scale !== 'number' || !Number.isFinite(asset.scale) || asset.scale <= 0) {
      findings.push(finding('ASSET_SCALE_INVALID', 'FAIL', 'Scale must be a finite number greater than zero.', 'Set a positive import scale.', subject))
    }
    if (!finiteVector3(asset.origin)) {
      findings.push(finding('ASSET_ORIGIN_INVALID', 'FAIL', 'Origin must contain exactly three finite coordinates.', 'Provide an [x, y, z] origin.', subject))
    }
    if (!nonEmptyString(asset.anchor) || !allowedAnchors.has(asset.anchor)) {
      findings.push(finding('ASSET_ANCHOR_INVALID', 'FAIL', `Anchor "${String(asset.anchor ?? '')}" is not recognized.`, 'Use a configured semantic anchor or extend the allowed anchor list.', subject))
    }
    if (!nonEmptyString(asset.license)) {
      findings.push(finding('ASSET_LICENSE_MISSING', 'FAIL', 'License metadata is missing.', 'Record the asset license or project ownership.', subject))
    }
    if (!nonEmptyString(asset.source)) {
      findings.push(finding('ASSET_SOURCE_MISSING', 'FAIL', 'Source metadata is missing.', 'Record a source URL, author, or local generation description.', subject))
    }
  })

  return createAuditReport(findings)
}
