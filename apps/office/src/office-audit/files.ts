import { validateGlb, validateGltfJson } from './gltf'
import { validateAssetManifest, isAssetManifest } from './manifest'
import { canonicalPath, extensionOf, isSafeLocalPath } from './paths'
import { createAuditReport, mergeAuditReports } from './report'
import type { AssetAuditOptions, AuditableAssetFile, AuditFinding, AuditReport } from './types'

export const DEFAULT_SUSPICIOUS_ASSET_BYTES = 25 * 1024 * 1024

export function auditAssetFiles(
  manifest: unknown,
  files: readonly AuditableAssetFile[],
  options: AssetAuditOptions = {},
): AuditReport {
  const manifestReport = validateAssetManifest(manifest, options)
  if (!isAssetManifest(manifest)) return manifestReport

  const findings: AuditFinding[] = []
  const fileIndex = new Map(
    files
      .filter(file => typeof file.path === 'string')
      .map(file => [canonicalPath(file.path), file]),
  )
  const availablePaths = new Set(fileIndex.keys())
  const inspectedPaths = new Set<string>()
  const suspiciousAssetBytes = options.suspiciousAssetBytes ?? DEFAULT_SUSPICIOUS_ASSET_BYTES

  for (const file of files) {
    if (typeof file.path !== 'string' || !isSafeLocalPath(file.path) || !file.path) {
      findings.push({
        code: 'ASSET_FILE_PATH_UNSAFE',
        severity: 'FAIL',
        description: `Supplied asset file path "${file.path}" is not a safe local path.`,
        subject: file.path,
        recommendation: 'Use a non-empty pack-local relative path without traversal, protocols, or backslashes.',
      })
    }
    if (!(file.bytes instanceof Uint8Array)) {
      findings.push({
        code: 'ASSET_FILE_BYTES_INVALID',
        severity: 'FAIL',
        description: `Supplied asset file "${file.path}" does not contain byte data.`,
        subject: file.path,
        recommendation: 'Load each asset as a Uint8Array before auditing it.',
      })
    }
  }

  for (const asset of manifest.assets) {
    if (typeof asset?.url !== 'string' || !isSafeLocalPath(asset.url)) continue
    const path = canonicalPath(asset.url)
    const file = fileIndex.get(path)
    if (!file) {
      findings.push({
        code: 'ASSET_FILE_MISSING',
        severity: 'FAIL',
        description: `Asset file "${path}" does not exist in the supplied file set.`,
        subject: typeof asset.id === 'string' ? asset.id : path,
        recommendation: 'Add the file to the pack or correct the manifest URL.',
      })
      continue
    }
    if (!(file.bytes instanceof Uint8Array)) continue
    if (file.bytes.byteLength > suspiciousAssetBytes) {
      findings.push({
        code: 'ASSET_FILE_SUSPICIOUSLY_LARGE',
        severity: 'WARNING',
        description: `Asset is ${file.bytes.byteLength} bytes, above the configured ${suspiciousAssetBytes}-byte review threshold.`,
        subject: typeof asset.id === 'string' ? asset.id : path,
        recommendation: 'Inspect geometry, textures, compression, and whether this file should be split or optimized.',
      })
    }
    if (typeof asset.sizeBytes === 'number' && Number.isSafeInteger(asset.sizeBytes) && asset.sizeBytes !== file.bytes.byteLength) {
      findings.push({
        code: 'ASSET_FILE_SIZE_MISMATCH',
        severity: 'FAIL',
        description: `Manifest declares ${asset.sizeBytes} bytes but the supplied file contains ${file.bytes.byteLength}.`,
        subject: typeof asset.id === 'string' ? asset.id : path,
        recommendation: 'Regenerate the manifest or provide the complete asset file.',
      })
    }
    if (inspectedPaths.has(path)) continue
    inspectedPaths.add(path)
    const extension = extensionOf(path)
    if (extension === '.glb') {
      findings.push(...validateGlb(file.bytes, path).findings.filter(item => item.code !== 'AUDIT_OK'))
    } else if (extension === '.gltf') {
      findings.push(...validateGltfJson(file.bytes, path, availablePaths).findings.filter(item => item.code !== 'AUDIT_OK'))
    }
  }

  return mergeAuditReports(manifestReport, createAuditReport(findings))
}
