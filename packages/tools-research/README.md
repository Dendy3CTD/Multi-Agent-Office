# `@mao-hybrid/tools-research`

Read-only technical research and component-sourcing tools for the existing MAO Hybrid Director and Runtime. This package adds no Director, Runtime, database, purchasing client, or global tool registry. It exports ordinary `ToolDefinition`s plus a task-scoped dispatcher and `mao_research` stdio MCP server.

## Tools and capabilities

| Tool | Capability | Purpose |
|---|---|---|
| `research.capabilities` | `research` | Describe the available research surface and evidence limits. |
| `research.web.search` | `technical-research` | Search DuckDuckGo's public HTML results. Results remain `UNVERIFIED` leads. |
| `research.component.search` | `component-sourcing` | Find candidate component pages from a query and requested characteristics. Unknown price/stock stay `null`; budget status stays `UNKNOWN`. |
| `research.component.inspect` | `component-sourcing` | Read an allowlisted public manufacturer/distributor page for explicit identity, offer, availability, and datasheet link fields. |
| `research.datasheet.extract` | `datasheet-analysis` | Read a manufacturer PDF/HTML datasheet and return quoted parameter matches with page and URL provenance. PDF extraction uses local `pdftotext`. |
| `research.component.compare` | `component-sourcing` | Compare tool-issued component evidence and expose `MATCH`, `DIFFERENT`, or `UNKNOWN` per sourced field. It does not decide electrical compatibility. |
| `research.bom.compile` | `bom` | Return structured BOM rows and totals only for current, evidence-backed prices in the same currency. It never orders parts. |

Research/technical analyst profiles receive web search and datasheet analysis. Electronics, electrical, and embedded engineers receive component search, comparison, datasheet analysis, and BOM compilation. Explicit profile skills may add the corresponding capability. Other employees receive only capabilities already explicitly assigned.

## Evidence and status policy

Every fetched value carries its source URL, source host, check time, extraction method, and a short evidence excerpt. Tool-issued values also carry an opaque evidence handle. Compare and BOM tools accept a value as sourced only if that handle still matches the value and source inside the current task-scoped process. Caller-authored `VERIFIED` labels and URLs are discarded. A process restart therefore requires re-fetching evidence; otherwise values become `UNVERIFIED`.

- `VERIFIED` means the exact value was extracted from an allowlisted public product page or manufacturer datasheet. It does **not** mean an engineer approved a design or verified system compatibility.
- `UNVERIFIED` means a search lead, missing evidence, or caller-supplied value that has not been fetched and checked.
- `NEEDS_DATASHEET` means an explicit datasheet field or datasheet link is missing or could not be extracted unambiguously.
- `OUTDATED` means a tool-issued value is older than the configured freshness window (30 days by default). It remains visible with provenance but is excluded from BOM totals.
- `BLOCKED` means a source is unavailable, rate-limited, challenged, outside the allowlist, too large, timed out, or otherwise not safely readable.

No price, currency, stock status, manufacturer, MPN, datasheet URL, or specification is inferred from marketing copy. Missing or locale-ambiguous prices are `null`; the parser does not guess decimal or thousands separators. Search snippets are never price or compatibility evidence. The BOM response groups totals by currency and never converts currencies.

## Sources and network/security behavior

- General search uses public DuckDuckGo HTML; no paid API key, account, cookie, browser automation, or CAPTCHA workflow is used.
- Product pages are fetched only over HTTPS from the package's explicit manufacturer/distributor host allowlist. Redirects are followed only while they remain on that allowlist.
- Datasheet URLs must be HTTPS and on an allowlisted manufacturer host. PDF downloads and `pdftotext` output have size/time limits. `pdftotext` is invoked as a fixed executable with argument arrays and no shell.
- HTTP 401/403/429, CAPTCHA/challenge pages, network failures, unknown hosts, and disallowed redirects return `BLOCKED` with a reason code. The package does not log in, retry around access controls, install tools, or bypass a site restriction.
- MCP tools are marked read-only and open-world for internet operations. The server does not add `approvedToolIds` or change Codex approval policy; ordinary MCP approval rules remain in force.
- MCP launch options bind project/task/execution IDs, the canonical registered workspace, the selected employee profile, its capabilities, and exact tool IDs. Tools do not write files or call purchase/order APIs.

The default free search adapter is a discovery source, not a guaranteed catalogue API. Public results may be empty, throttled, or unavailable; in those cases tools report `BLOCKED` or `NEEDS_DATASHEET`. A supplied budget is a search query hint only; a candidate is never judged within budget until its exact current page price and currency are read. Supplier price and stock page formats vary, so only explicit JSON-LD Offer or supported product metadata is extracted. A shop's page value is a timestamped listing observation, not a guaranteed purchasable quote.

## Task-scoped host wiring

Call after the host has selected the employee, claimed the step, and resolved the registered project workspace:

```ts
import { createTaskResearchDispatcher } from "@mao-hybrid/tools-research";

const dispatcher = createTaskResearchDispatcher({
  projectId: task.projectId,
  taskId: task.id,
  executionId: execution.id,
  workspaceRoot: project.workspaceRoot,
  employee: { id: employee.id, professionId: employee.professionId, skills: employee.skills },
});

taskTools = {
  ...taskTools,
  tools: [...taskTools.tools, ...dispatcher.summaries],
  mcpServers: [...taskTools.mcpServers, dispatcher.mcpServer],
};
```

The host must first reject duplicate tool IDs and MCP server names as it does for Coding/Electronics/CAD dispatchers. Do not put workspace-bound executors in global discovery. A profile without an assigned research capability gets no research tools.

## Example: ESP32, sensors, and power supply

```sh
MAO_PROJECT_WORKSPACE=/absolute/path/to/registered/project node packages/tools-research/examples/esp32-sensors-power.mjs
```

The example prints current source results and their statuses. It does not include hard-coded prices or promise that any result is live; run it with network access to obtain actual public-source responses. Tests use clearly local fixture responses and do not claim live-store verification.

## Verification

```sh
corepack pnpm --filter @mao-hybrid/tools-research build
corepack pnpm --filter @mao-hybrid/tools-research typecheck
corepack pnpm --filter @mao-hybrid/tools-research test
```

The package's stdio MCP test starts the built server in a child process and checks initialize, tools/list, capabilities, and rejection of a tool outside the selected task surface. The fetch/parser tests use deterministic fixtures; a live shop, current price, inventory, and manufacturer PDF review are deliberately deferred to the separately authorized source-validation session.
