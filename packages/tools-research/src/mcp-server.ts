import { createInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTaskResearchDispatcher, researchCapabilitiesForEmployee, type ResearchEmployee, type ResearchTaskDispatcher, type ResearchToolResult } from './index.js';

export interface ResearchMcpLaunchOptions {
  readonly projectId: string;
  readonly taskId: string;
  readonly executionId: string;
  readonly workspaceRoot: string;
  readonly employee: ResearchEmployee;
  readonly employeeCapabilities: readonly string[];
  readonly allowedToolIds: readonly string[];
}

export interface ResearchMcpHandlers {
  readonly dispatcher: ResearchTaskDispatcher;
  handle(message: unknown): Promise<Record<string, unknown> | undefined>;
}

export function createResearchMcpHandlers(options: ResearchMcpLaunchOptions): ResearchMcpHandlers {
  validateLaunchOptions(options);
  const dispatcher = createTaskResearchDispatcher({
    projectId: options.projectId, taskId: options.taskId, executionId: options.executionId,
    workspaceRoot: options.workspaceRoot, employee: options.employee,
  });
  assertExactSubset(options.employeeCapabilities, dispatcher.tools.length ? researchCapabilitiesForEmployee(options.employee) : [], 'employeeCapabilities');
  const capabilityFilteredTools = dispatcher.tools.filter(tool => tool.capabilities?.some(capability => options.employeeCapabilities.includes(capability)));
  assertExactSubset(options.allowedToolIds, capabilityFilteredTools.map(tool => tool.id), 'allowedToolIds');
  const allowed = new Set(options.allowedToolIds);
  const taskTools = capabilityFilteredTools.filter(tool => allowed.has(tool.id));

  return Object.freeze({
    dispatcher,
    async handle(raw: unknown) {
      if (!isRecord(raw) || raw.jsonrpc !== '2.0' || typeof raw.method !== 'string') {
        return { jsonrpc: '2.0', id: isRecord(raw) && 'id' in raw ? raw.id : null, error: { code: -32700, message: 'Invalid JSON-RPC message' } };
      }
      if (!('id' in raw)) return undefined;
      const id = raw.id;
      const params = isRecord(raw.params) ? raw.params : {};
      try {
        if (raw.method === 'initialize') {
          return { jsonrpc: '2.0', id, result: { protocolVersion: typeof params.protocolVersion === 'string' ? params.protocolVersion : '2025-03-26', capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'mao-research-tools', version: '0.1.0' } } };
        }
        if (raw.method === 'ping') return { jsonrpc: '2.0', id, result: {} };
        if (raw.method === 'tools/list') {
          return { jsonrpc: '2.0', id, result: { tools: taskTools.map(tool => ({ name: tool.id, description: tool.description, inputSchema: tool.inputSchema, ...(tool.annotations ? { annotations: tool.annotations } : {}) })) } };
        }
        if (raw.method === 'tools/call') {
          if (typeof params.name !== 'string' || !allowed.has(params.name)) return { jsonrpc: '2.0', id, error: { code: -32602, message: 'Research tool is not permitted for this task' } };
          if (!isRecord(params.arguments ?? {})) throw new TypeError('Tool arguments must be a JSON object');
          const result = await dispatcher.invoke(params.name, params.arguments ?? {});
          return mcpToolResult(id, result);
        }
        return { jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } };
      } catch (error) {
        return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: error instanceof Error ? error.message.slice(0, 1200) : 'Research tool call failed' }], isError: true } };
      }
    },
  });
}

export async function runResearchMcpServer(options: ResearchMcpLaunchOptions, streams: { readonly input?: Readable; readonly output?: Writable } = {}): Promise<void> {
  const handlers = createResearchMcpHandlers(options);
  const input = createInterface({ input: streams.input ?? process.stdin, crlfDelay: Infinity });
  const output = streams.output ?? process.stdout;
  for await (const line of input) {
    if (line.length > 1_000_000) {
      write(output, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Message too large' } });
      continue;
    }
    let message: unknown;
    try { message = JSON.parse(line); }
    catch { write(output, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Invalid JSON-RPC message' } }); continue; }
    const response = await handlers.handle(message);
    if (response) write(output, response);
  }
}

function mcpToolResult(id: unknown, result: ResearchToolResult): Record<string, unknown> {
  const isError = result.status === 'BLOCKED';
  let text: string;
  try { text = JSON.stringify(result); }
  catch { text = JSON.stringify({ toolId: result.toolId, status: 'BLOCKED', reasonCode: 'result_serialization_failed' }); }
  return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text }], structuredContent: result, isError } };
}

function validateLaunchOptions(options: ResearchMcpLaunchOptions): void {
  if (![options.projectId, options.taskId, options.executionId].every(value => typeof value === 'string' && value.trim().length > 0 && value.length <= 160)) throw new TypeError('Invalid task-scoped research identity');
  if (typeof options.workspaceRoot !== 'string' || !options.workspaceRoot.startsWith('/')) throw new TypeError('Research workspace must be an absolute registered path');
  if (!options.employee || typeof options.employee.professionId !== 'string' || !Array.isArray(options.employee.skills) || options.employee.skills.some(skill => typeof skill !== 'string') || options.employee.skills.length > 64) throw new TypeError('Invalid research employee profile');
  if (!Array.isArray(options.employeeCapabilities) || options.employeeCapabilities.length > 16 || options.employeeCapabilities.some(value => typeof value !== 'string')) throw new TypeError('Invalid research capability list');
  if (!Array.isArray(options.allowedToolIds) || options.allowedToolIds.length > 16 || options.allowedToolIds.some(value => typeof value !== 'string')) throw new TypeError('Invalid task-scoped research tool list');
}

function assertExactSubset(requested: readonly string[], permitted: readonly string[], name: string): void {
  const expected = permitted.filter(value => requested.includes(value));
  if (new Set(requested).size !== requested.length || requested.length !== expected.length || requested.some((value, index) => value !== expected[index])) throw new TypeError(`Task-scoped ${name} do not match the selected employee capabilities`);
}

function write(output: Writable, value: unknown): void { output.write(`${JSON.stringify(value)}\n`); }
function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value && typeof value === 'object' && !Array.isArray(value)); }

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    const raw = process.argv[2];
    if (!raw || raw.length > 32_000) throw new TypeError('Missing or oversized research MCP launch options');
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value) || typeof value.projectId !== 'string' || typeof value.taskId !== 'string' || typeof value.executionId !== 'string' || typeof value.workspaceRoot !== 'string' || !isRecord(value.employee) || typeof value.employee.professionId !== 'string' || !Array.isArray(value.employee.skills) || value.employee.skills.some(item => typeof item !== 'string') || !Array.isArray(value.employeeCapabilities) || value.employeeCapabilities.some(item => typeof item !== 'string') || !Array.isArray(value.allowedToolIds) || value.allowedToolIds.some(item => typeof item !== 'string')) throw new TypeError('Invalid research MCP launch options');
    await runResearchMcpServer(value as unknown as ResearchMcpLaunchOptions);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : 'Research MCP server failed'}\n`);
    process.exitCode = 1;
  }
}
