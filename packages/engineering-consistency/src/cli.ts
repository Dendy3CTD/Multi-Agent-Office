import { resolve } from 'node:path'
import { readEngineeringProjectManifest, writeIntegrationReports } from './index.js'

const [manifestPath, outputPath = './integration-report'] = process.argv.slice(2)
if (!manifestPath) {
  process.stderr.write('Usage: node dist/cli.js <project-manifest.json> [output-directory]\n')
  process.exitCode = 2
} else {
  try {
    const manifest = await readEngineeringProjectManifest(resolve(manifestPath))
    const { report, jsonPath, markdownPath } = await writeIntegrationReports(manifest, resolve(outputPath))
    process.stdout.write(`${report.status}\nJSON: ${jsonPath}\nMarkdown: ${markdownPath}\n`)
    if (report.status !== 'READY_TO_BUILD') process.exitCode = 1
  } catch (error) {
    process.stderr.write(`Engineering consistency check failed: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 2
  }
}
