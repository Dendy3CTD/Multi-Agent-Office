import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import test from 'node:test';
import { listTools } from '@mao-hybrid/contracts';
import { createCodingTools, createPlaywrightBrowserPort, createTaskCodingDispatcher, filterCodingToolsByCapabilities } from '../dist/index.js';

function workspace() {
  const root = mkdtempSync(join(tmpdir(), 'mao-coding-tools-'));
  execFileSync('git', ['init', '-q', root]);
  execFileSync('git', ['-C', root, 'config', 'user.name', 'MAO Test']);
  execFileSync('git', ['-C', root, 'config', 'user.email', 'mao-test@example.invalid']);
  writeFileSync(join(root, 'README.md'), 'temporary fixture\n');
  execFileSync('git', ['-C', root, 'add', 'README.md']);
  execFileSync('git', ['-C', root, 'commit', '-qm', 'baseline']);
  return root;
}
function tool(set, id) {
  const value = set.tools.find((entry) => entry.id === id);
  assert.ok(value, `missing tool ${id}`);
  return value;
}

test('exposes coding capabilities through the existing ToolSummary input schema', () => {
  const root = workspace();
  try {
    const set = createCodingTools({ workspaceRoot: root });
    const summary = set.tools.find((item) => item.id === 'coding.check.run');
    assert.deepEqual(summary.inputSchema['x-mao-capabilities'], ['coding', 'testing', 'python', 'rust', 'typescript', 'javascript', 'c', 'cpp', 'shell', 'web']);
    assert.ok(set.tools.some((item) => item.id === 'coding.git.status'));
    assert.ok(set.tools.some((item) => item.id === 'coding.github.read'));
    assert.ok(filterCodingToolsByCapabilities(set.tools, ['coding']).some((item) => item.id === 'coding.git.status'));
    assert.equal(filterCodingToolsByCapabilities(set.tools, ['github-write']).some((item) => item.id === 'coding.github.push'), true);
    set.register();
    assert.ok(listTools().find((item) => item.id === 'coding.git.status').inputSchema['x-mao-capabilities'].includes('git'));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('creates a developer-only task dispatcher that enforces tool IDs and the registered workspace', async () => {
  const root = workspace();
  const other = workspace();
  try {
    writeFileSync(join(root, 'sum.js'), 'export const sum = (a, b) => a + b;\n');
    writeFileSync(join(root, 'sum.test.js'), "import test from 'node:test'; import assert from 'node:assert/strict'; import { sum } from './sum.js'; test('sum', () => assert.equal(sum(2, 3), 5));\n");
    const developer = createTaskCodingDispatcher({
      projectId: 'project-a', taskId: 'task-a', executionId: 'execution-a',
      workspaceRoot: root,
      employee: { professionId: 'developer', skills: ['coding'] },
    });
    const analyst = createTaskCodingDispatcher({
      projectId: 'project-b', taskId: 'task-b', executionId: 'execution-b',
      workspaceRoot: other,
      employee: { professionId: 'analyst', skills: ['analysis'] },
    });
    const qa = createTaskCodingDispatcher({ projectId: 'project-b', taskId: 'task-qa', executionId: 'execution-qa', workspaceRoot: other, employee: { professionId: 'qa-engineer', skills: ['testing'] } });
    assert.ok(developer.tools.some(entry => entry.id === 'coding.check.run'));
    assert.ok(developer.tools.some(entry => entry.id === 'coding.git.status'));
    assert.ok(developer.tools.some(entry => entry.id === 'coding.git.branch.create'));
    assert.ok(!developer.tools.some(entry => entry.id === 'coding.github.push'));
    assert.equal(analyst.tools.length, 0);
    assert.ok(qa.tools.some(entry => entry.id === 'coding.check.run'));
    await assert.rejects(qa.invoke('coding.check.run', { check: 'rust-test' }), error => error.code === 'tool_capability_denied');
    const result = await developer.invoke('coding.check.run', { check: 'javascript-test', paths: ['sum.test.js'] });
    assert.equal(result.status, 'passed');
    const branch = await developer.invoke('coding.git.branch.create', { name: 'mao/task-tool-test', confirmed: true });
    assert.equal(branch.status, 'passed');
    await assert.rejects(developer.invoke('coding.github.push', { branch: 'main', confirmation: 'PUSH main' }), error => error.code === 'tool_not_allowed');
    await assert.rejects(developer.invoke('coding.check.run', { check: 'javascript-test', paths: ['../project-b/secret.test.js'] }), /outside the selected workspace/);
    assert.equal(developer.mcpServer.allowedTools.includes('coding.github.push'), false);
    assert.equal(developer.workspaceRoot, root);
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(other, { recursive: true, force: true }); }
});

test('serves an actual task-scoped MCP tools/list and tools/call exchange', async () => {
  const root = workspace();
  try {
    writeFileSync(join(root, 'sum.js'), 'export const sum = (a, b) => a + b;\n');
    writeFileSync(join(root, 'sum.test.js'), "import test from 'node:test'; import assert from 'node:assert/strict'; import { sum } from './sum.js'; test('sum', () => assert.equal(sum(2, 3), 5));\n");
    const dispatcher = createTaskCodingDispatcher({ projectId: 'project-a', taskId: 'task-a', executionId: 'execution-a', workspaceRoot: root, employee: { id: 'dev-1', professionId: 'developer', skills: ['coding'] } });
    const requests = [
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } },
      { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
      { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'coding.check.run', arguments: { check: 'javascript-test', paths: ['sum.test.js'] } } },
      { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'coding.github.push', arguments: { branch: 'main', confirmation: 'PUSH main' } } },
    ];
    const output = execFileSync(dispatcher.mcpServer.command, dispatcher.mcpServer.args, { encoding: 'utf8', input: requests.map(request => JSON.stringify(request)).join('\n') + '\n', timeout: 5_000 });
    const responses = output.trim().split('\n').map(line => JSON.parse(line));
    const toolList = responses.find(response => response.id === 2).result.tools;
    const listed = toolList.map(tool => tool.name);
    assert.ok(listed.includes('coding.check.run'));
    assert.ok(listed.includes('coding.git.branch.create'));
    assert.ok(!listed.includes('coding.github.push'));
    assert.deepEqual(toolList.find(tool => tool.name === 'coding.capabilities').annotations, { readOnlyHint: true, destructiveHint: false, openWorldHint: false });
    assert.deepEqual(toolList.find(tool => tool.name === 'coding.git.status').annotations, { readOnlyHint: true, destructiveHint: false, openWorldHint: false });
    assert.equal(toolList.find(tool => tool.name === 'coding.check.run').annotations, undefined, 'checks execute project code and are not declared read-only');
    assert.equal(responses.find(response => response.id === 3).result.structuredContent.status, 'passed');
    assert.equal(responses.find(response => response.id === 4).error.code, -32602);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('returns structured blocked/not_repository from MCP when the registered workspace has no Git repository', async () => {
  const root = mkdtempSync(join(tmpdir(), 'mao-coding-non-git-'));
  try {
    const direct = await tool(createCodingTools({ workspaceRoot: root }), 'coding.git.status').execute({});
    assert.equal(direct.status, 'blocked');
    assert.equal(direct.reasonCode, 'not_repository');
    assert.equal(direct.exitCode, null);

    const dispatcher = createTaskCodingDispatcher({ projectId: 'plain-project', taskId: 'plain-task', executionId: 'plain-execution', workspaceRoot: root, employee: { professionId: 'developer', skills: ['coding'] } });
    const requests = [
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } },
      { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'coding.git.status', arguments: {} } },
    ];
    const output = execFileSync(dispatcher.mcpServer.command, dispatcher.mcpServer.args, { encoding: 'utf8', input: requests.map(request => JSON.stringify(request)).join('\n') + '\n', timeout: 5_000 });
    const response = JSON.parse(output.trim().split('\n')[1]);
    assert.equal(response.error, undefined, 'not a Git repository is a semantic tool result, not an MCP transport error');
    assert.equal(response.result.isError, false);
    assert.equal(response.result.structuredContent.status, 'blocked');
    assert.equal(response.result.structuredContent.reasonCode, 'not_repository');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('keeps a repository-root binding violation as an MCP error instead of a not_repository block', async () => {
  const root = workspace();
  const nested = join(root, 'nested-root');
  mkdirSync(nested);
  try {
    const dispatcher = createTaskCodingDispatcher({ projectId: 'bound-project', taskId: 'bound-task', executionId: 'bound-execution', workspaceRoot: root, repositoryRoot: nested, employee: { professionId: 'developer', skills: ['coding'] } });
    const requests = [
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } },
      { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'coding.git.status', arguments: {} } },
    ];
    const output = execFileSync(dispatcher.mcpServer.command, dispatcher.mcpServer.args, { encoding: 'utf8', input: requests.map(request => JSON.stringify(request)).join('\n') + '\n', timeout: 5_000 });
    const response = JSON.parse(output.trim().split('\n')[1]);
    assert.equal(response.error, undefined);
    assert.equal(response.result.isError, true);
    assert.match(response.result.content[0].text, /Git root does not match/);
    assert.equal(response.result.structuredContent, undefined);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('runs an actual isolated JavaScript test, applies a fix, and reports the Git diff', async () => {
  const root = workspace();
  try {
    writeFileSync(join(root, 'sum.js'), 'export function sum(a, b) { return a - b; }\n');
    writeFileSync(join(root, 'sum.test.js'), "import test from 'node:test'; import assert from 'node:assert/strict'; import { sum } from './sum.js'; test('sum adds', () => assert.equal(sum(2, 3), 5));\n");
    execFileSync('git', ['-C', root, 'add', 'sum.js', 'sum.test.js']);
    execFileSync('git', ['-C', root, 'commit', '-qm', 'initial fixture']);
    const set = createCodingTools({ workspaceRoot: root });
    const failed = await tool(set, 'coding.check.run').execute({ check: 'javascript-test', paths: ['sum.test.js'] });
    assert.equal(failed.status, 'failed', JSON.stringify(failed));
    assert.equal(failed.exitCode, 1);
    assert.match(failed.command, /node --test/);
    assert.ok(failed.durationMs >= 0);

    writeFileSync(join(root, 'sum.js'), 'export function sum(a, b) { return a + b; }\n');
    const passed = await tool(set, 'coding.check.run').execute({ check: 'javascript-test', paths: ['sum.test.js'], artifacts: ['sum.js'] });
    assert.equal(passed.status, 'passed');
    assert.equal(passed.exitCode, 0);
    assert.match(passed.stdout, /pass 1/);
    assert.equal(passed.artifacts.length, 1);
    assert.match(passed.artifacts[0].uri, /^file:/);

    const diff = await tool(set, 'coding.git.diff').execute({});
    assert.equal(diff.status, 'passed');
    assert.match(diff.stdout, /return a \+ b/);
    assert.match(diff.command, /git diff/);
    const status = await tool(set, 'coding.git.status').execute({});
    assert.equal(status.status, 'passed');
    assert.match(status.stdout, /sum.js/);
    const log = await tool(set, 'coding.git.log').execute({ limit: 3 });
    assert.equal(log.status, 'passed');
    assert.match(log.stdout, /initial fixture/);
    const prDraft = await tool(set, 'coding.github.prepare-pr').execute({});
    assert.equal(prDraft.status, 'passed');
    assert.match(prDraft.message, /no push or pull request was created/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('limits Git operations to the selected repository and requires explicit write mode', async () => {
  const root = workspace();
  try {
    const set = createCodingTools({ workspaceRoot: root });
    const branch = await tool(set, 'coding.git.branch.create').execute({ name: 'mao/test-branch' });
    assert.equal(branch.status, 'blocked');
    assert.equal(branch.exitCode, null);
    assert.equal(execFileSync('git', ['-C', root, 'branch', '--list', 'mao/test-branch'], { encoding: 'utf8' }).trim(), '');
    await assert.rejects(tool(set, 'coding.git.diff').execute({ path: '../../etc/passwd' }), /outside the selected workspace/);

    const enabled = createCodingTools({ workspaceRoot: root, allowLocalGitWrites: true });
    const confirmed = await tool(enabled, 'coding.git.branch.create').execute({ name: 'mao/test-branch', confirmed: true });
    assert.equal(confirmed.status, 'passed', JSON.stringify(confirmed));
    assert.equal(execFileSync('git', ['-C', root, 'branch', '--list', 'mao/test-branch'], { encoding: 'utf8' }).trim(), 'mao/test-branch');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('commits only explicitly selected paths and only in enabled, confirmed mode', async () => {
  const root = workspace();
  try {
    writeFileSync(join(root, 'change.txt'), 'reviewed change\n');
    const disabled = createCodingTools({ workspaceRoot: root });
    const blocked = await tool(disabled, 'coding.git.commit').execute({ message: 'Add reviewed fixture', paths: ['change.txt'], confirmed: true });
    assert.equal(blocked.status, 'blocked');
    assert.equal(execFileSync('git', ['-C', root, 'log', '-1', '--format=%s'], { encoding: 'utf8' }).trim(), 'baseline');
    const enabled = createCodingTools({ workspaceRoot: root, allowLocalGitWrites: true });
    const committed = await tool(enabled, 'coding.git.commit').execute({ message: 'Add reviewed fixture', paths: ['change.txt'], confirmed: true });
    assert.equal(committed.status, 'passed', JSON.stringify(committed));
    assert.equal(execFileSync('git', ['-C', root, 'log', '-1', '--format=%s'], { encoding: 'utf8' }).trim(), 'Add reviewed fixture');
    assert.equal(execFileSync('git', ['-C', root, 'status', '--porcelain'], { encoding: 'utf8' }).trim(), '');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('reports unavailable compilers as blocked, never as a passing check', async () => {
  const root = workspace();
  try {
    const set = createCodingTools({ workspaceRoot: root, commandAvailability: () => false });
    const result = await tool(set, 'coding.check.run').execute({ check: 'rust-test' });
    assert.equal(result.status, 'blocked');
    assert.equal(result.exitCode, null);
    assert.match(result.stderr, /cargo.*unavailable/i);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('rejects source paths that escape the registered workspace through a symlink', async () => {
  const root = workspace();
  const outside = mkdtempSync(join(tmpdir(), 'mao-coding-outside-'));
  try {
    writeFileSync(join(outside, 'escape.js'), 'process.exit(99)\n');
    symlinkSync(outside, join(root, 'linked-project'));
    const set = createCodingTools({ workspaceRoot: root });
    await assert.rejects(tool(set, 'coding.check.run').execute({ check: 'javascript-check', paths: ['linked-project/escape.js'] }), /symlink outside/);
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(outside, { recursive: true, force: true }); }
});

test('does not pass inherited API keys to project check processes', async () => {
  const root = workspace();
  const previous = process.env.MAO_TEST_SECRET;
  process.env.MAO_TEST_SECRET = 'fixture-secret';
  try {
    writeFileSync(join(root, 'env.test.js'), "import test from 'node:test'; import assert from 'node:assert/strict'; test('secrets are omitted', () => assert.equal(process.env.MAO_TEST_SECRET, undefined));\n");
    const set = createCodingTools({ workspaceRoot: root });
    const result = await tool(set, 'coding.check.run').execute({ check: 'javascript-test', paths: ['env.test.js'] });
    assert.equal(result.status, 'passed', JSON.stringify(result));
  } finally {
    if (previous === undefined) delete process.env.MAO_TEST_SECRET; else process.env.MAO_TEST_SECRET = previous;
    rmSync(root, { recursive: true, force: true });
  }
});

test('runs project checks in a filesystem sandbox that blocks writes outside the project workspace', async () => {
  const root = workspace();
  try {
    writeFileSync(join(root, 'sandbox.test.js'), "import test from 'node:test'; import assert from 'node:assert/strict'; import { writeFileSync } from 'node:fs'; test('host path is read-only', () => assert.throws(() => writeFileSync('/tmp/mao-coding-host-escape-marker', 'escape')));\n");
    const set = createCodingTools({ workspaceRoot: root });
    const result = await tool(set, 'coding.check.run').execute({ check: 'javascript-test', paths: ['sandbox.test.js'] });
    assert.equal(result.status, 'passed', JSON.stringify(result));
    assert.match(result.command, /node --test/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('runs installed Python, C, C++ and Shell check tools on project files', async () => {
  const root = workspace();
  try {
    writeFileSync(join(root, 'module.py'), 'answer = 42\n');
    writeFileSync(join(root, 'main.c'), 'int main(void) { return 0; }\n');
    writeFileSync(join(root, 'main.cpp'), '#include <iostream>\nint main() { std::cout << "ok"; }\n');
    writeFileSync(join(root, 'script.sh'), '#!/bin/sh\necho ok\n');
    const set = createCodingTools({ workspaceRoot: root });
    for (const [check, paths] of [['python-compile', undefined], ['c-check', ['main.c']], ['cpp-check', ['main.cpp']], ['shell-check', ['script.sh']]]) {
      const result = await tool(set, 'coding.check.run').execute({ check, ...(paths ? { paths } : {}) });
      assert.equal(result.status, 'passed', `${check}: ${JSON.stringify(result)}`);
      assert.equal(result.exitCode, 0);
    }
    const pytest = await tool(set, 'coding.check.run').execute({ check: 'python-test' });
    if (pytest.status === 'blocked') assert.equal(pytest.exitCode, null);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('keeps browser automation on configured origins and records console errors and screenshots', async () => {
  const root = workspace();
  const calls = [];
  const page = {
    on(event, handler) { if (event === 'console') handler({ type: () => 'error', text: () => 'browser failure' }); },
    async goto(url) { calls.push(['goto', url]); },
    url() { return 'http://127.0.0.1:5173/'; },
    locator(selector) { return { async click() { calls.push(['click', selector]); }, async fill(value) { calls.push(['fill', selector, value]); }, async textContent() { return 'Welcome'; } }; },
    async screenshot({ path }) { writeFileSync(path, 'png-fixture'); },
    async close() {},
  };
  const browser = { contexts: () => [{ pages: () => [page], async newPage() { return page; } }], async close() {} };
  try {
    const port = createPlaywrightBrowserPort({ playwright: { chromium: { async connectOverCDP() { return browser; } } }, cdpEndpoint: 'http://127.0.0.1:9222', workspaceRoot: root, allowedOrigins: ['http://127.0.0.1:5173'] });
    await assert.rejects(port.runScenario({ url: 'https://example.com', actions: [] }), /outside configured applications/);
    const result = await port.runScenario({ url: 'http://127.0.0.1:5173/', actions: [{ type: 'assertText', selector: 'h1', text: 'Welcome' }, { type: 'screenshot', name: 'home.png' }] });
    assert.equal(result.status, 'failed');
    assert.deepEqual(result.consoleErrors, ['browser failure']);
    assert.equal(readFileSync(join(root, 'artifacts', 'home.png'), 'utf8'), 'png-fixture');
    assert.deepEqual(calls[0], ['goto', 'http://127.0.0.1:5173/']);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('uses only read-only gh commands and reports missing gh as blocked', async () => {
  const root = workspace();
  try {
    const set = createCodingTools({ workspaceRoot: root, commandAvailability: (name) => name !== 'gh' });
    const result = await tool(set, 'coding.github.read').execute({ action: 'issues' });
    assert.equal(result.status, 'blocked');
    assert.equal(result.exitCode, null);
    assert.match(result.stderr, /gh CLI is not installed/);
    const write = await tool(set, 'coding.github.push').execute({ branch: 'main', confirmation: 'PUSH main' });
    assert.equal(write.status, 'blocked');
    assert.match(write.stderr, /External GitHub write blocked/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('reviews the selected diff locally and delegates content review through the injected existing-runtime port', async () => {
  const root = workspace();
  let reviewRequest;
  try {
    writeFileSync(join(root, 'src.js'), 'export function run(value) { return value; }\n');
    execFileSync('git', ['-C', root, 'add', 'src.js']);
    execFileSync('git', ['-C', root, 'commit', '-qm', 'add source']);
    writeFileSync(join(root, 'src.js'), 'export function run(value) { return eval(value); }\n');
    const set = createCodingTools({ workspaceRoot: root, codeReviewPort: { async review(input) { reviewRequest = input; return { summary: 'Runtime review complete', findings: [{ severity: 'high', title: 'Unsafe evaluation' }] }; } } });
    const result = await tool(set, 'coding.review.diff').execute({ requirements: ['Do not evaluate user input'], checks: [{ status: 'passed', command: 'node --test' }] });
    assert.equal(result.status, 'completed');
    assert.match(reviewRequest.diff, /eval\(value\)/);
    assert.deepEqual(reviewRequest.requirements, ['Do not evaluate user input']);
    assert.ok(result.staticFindings.some((finding) => finding.rule === 'dynamic-code-evaluation'));
    assert.equal(result.runtimeReview.summary, 'Runtime review complete');
    assert.equal(result.checks[0].status, 'passed');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('maps browser scenarios onto official Chrome DevTools MCP page, input, snapshot and screenshot tools', async () => {
  const root = workspace();
  const calls = [];
  const port = createCodingTools({ workspaceRoot: root, browserPort: createMcpPort(root, calls) });
  try {
    const result = await tool(port, 'coding.browser.scenario').execute({
      url: 'http://127.0.0.1:5173/',
      actions: [{ type: 'snapshot' }, { type: 'click', uid: 'button-1' }, { type: 'fill', uid: 'input-2', value: 'MAO' }, { type: 'assertText', text: 'Welcome' }, { type: 'screenshot', name: 'mcp.png' }],
    });
    assert.equal(result.status, 'failed');
    assert.ok(calls.some(([name]) => name === 'new_page'));
    assert.ok(calls.some(([name]) => name === 'click'));
    assert.ok(calls.some(([name]) => name === 'fill'));
    assert.ok(calls.some(([name]) => name === 'take_screenshot'));
    assert.ok(calls.some(([name]) => name === 'list_console_messages'));
    assert.equal(result.consoleErrors.length, 1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('starts and stops only an explicitly registered loopback application server', async () => {
  const root = workspace();
  const port = await freePort();
  writeFileSync(join(root, 'server.mjs'), "import { createServer } from 'node:http'; createServer((_req,res)=>{res.end('ready')}).listen(Number(process.env.PORT), '127.0.0.1');\n");
  const set = createCodingTools({ workspaceRoot: root, localServers: [{ id: 'fixture-app', cwd: root, command: 'node', args: ['server.mjs'], urlTemplate: 'http://127.0.0.1:{port}/' }] });
  try {
    const started = await tool(set, 'coding.web.start').execute({ appId: 'fixture-app', port });
    assert.equal(started.status, 'passed', JSON.stringify(started));
    assert.equal(started.url, `http://127.0.0.1:${port}/`);
    assert.equal(await (await fetch(started.url)).text(), 'ready');
    const stopped = await tool(set, 'coding.web.stop').execute({ appId: 'fixture-app' });
    assert.equal(stopped.status, 'passed');
    await assert.rejects(fetch(started.url));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

async function freePort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

function createMcpPort(root, calls) {
  return {
    allowedOrigins: ['http://127.0.0.1:5173'],
    async runScenario(input) {
      const { createChromeDevToolsMcpPort } = await import('../dist/index.js');
      return createChromeDevToolsMcpPort({
        workspaceRoot: root,
        allowedOrigins: ['http://127.0.0.1:5173'],
        async callTool(name, args) {
          calls.push([name, args]);
          if (name === 'new_page') return { structuredContent: { pageId: 9 } };
          if (name === 'take_snapshot') return { content: [{ type: 'text', text: 'heading Welcome button-1 input-2' }] };
          if (name === 'take_screenshot') { writeFileSync(args.filePath, 'mcp-image'); return { content: [] }; }
          if (name === 'list_console_messages') return { content: [{ type: 'text', text: 'console error: offline' }] };
          return { content: [] };
        },
      }).runScenario(input);
    },
  };
}
