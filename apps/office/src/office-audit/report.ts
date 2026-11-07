import type { AuditFinding, AuditReport, AuditStatus } from './types'

export function createAuditReport(findings: readonly AuditFinding[]): AuditReport {
  const materialized = findings.length > 0
    ? [...findings]
    : [{
        code: 'AUDIT_OK',
        severity: 'PASS' as const,
        description: 'All available checks passed.',
        recommendation: 'Keep the same validation in the asset build pipeline.',
      }]
  const summary = materialized.reduce(
    (counts, finding) => {
      counts[finding.severity.toLowerCase() as Lowercase<AuditStatus>] += 1
      return counts
    },
    { pass: 0, warning: 0, fail: 0 },
  )
  const status: AuditStatus = summary.fail > 0 ? 'FAIL' : summary.warning > 0 ? 'WARNING' : 'PASS'
  return { status, findings: materialized, summary }
}

export function mergeAuditReports(...reports: readonly AuditReport[]): AuditReport {
  return createAuditReport(
    reports.flatMap(report => report.findings.filter(finding => finding.code !== 'AUDIT_OK')),
  )
}

export function formatAuditReport(report: AuditReport): string {
  const lines = [
    `Asset audit: ${report.status}`,
    `Summary: ${report.summary.fail} fail, ${report.summary.warning} warning, ${report.summary.pass} pass`,
  ]
  for (const finding of report.findings) {
    const related = finding.file ?? finding.asset ?? finding.metric ?? finding.subject
    const subject = related ? ` [${related}]` : ''
    lines.push(`${finding.severity} ${finding.code}${subject}: ${finding.description}`)
    lines.push(`  Recommendation: ${finding.recommendation}`)
  }
  return lines.join('\n')
}
