const URI_SCHEME = /^[a-z][a-z\d+.-]*:/i

export function extensionOf(path: string): string {
  const cleanPath = path.split(/[?#]/, 1)[0]
  const dot = cleanPath.lastIndexOf('.')
  return dot < 0 ? '' : cleanPath.slice(dot).toLowerCase()
}

export function isEmbeddedDataUri(path: string): boolean {
  return path.startsWith('data:')
}

export function isSafeLocalPath(path: string): boolean {
  if (!path || path.includes('\\') || path.includes('\0') || path.startsWith('//')) return false
  if (URI_SCHEME.test(path)) return false
  let pathOnly: string
  try {
    pathOnly = decodeURIComponent(path.split(/[?#]/, 1)[0])
  } catch {
    return false
  }
  if (pathOnly.includes('\\') || pathOnly.includes('\0') || pathOnly.startsWith('//')) return false
  const segments = pathOnly.split('/')
  return !segments.some(segment => segment === '..' || segment === '.')
}

export function canonicalPath(path: string): string {
  return path.split(/[?#]/, 1)[0].replace(/^\/+/, '').replace(/\/{2,}/g, '/')
}

export function resolveSiblingPath(parentPath: string, childPath: string): string | undefined {
  if (!isSafeLocalPath(childPath)) return undefined
  if (childPath.startsWith('/')) return canonicalPath(childPath)
  const parent = canonicalPath(parentPath)
  const slash = parent.lastIndexOf('/')
  return canonicalPath(`${slash < 0 ? '' : parent.slice(0, slash + 1)}${childPath}`)
}
