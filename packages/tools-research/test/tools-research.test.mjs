import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  RESEARCH_TOOL_IDS,
  createResearchTools,
  createTaskResearchDispatcher,
  filterResearchToolsByCapabilities,
  researchCapabilitiesForEmployee,
} from '../dist/index.js';
import { createResearchMcpHandlers } from '../dist/mcp-server.js';

const NOW = '2026-11-20T12:00:00.000Z';
const PRODUCT_URL = 'https://www.digikey.com/en/products/detail/espressif-systems/ESP32-DEVKITC-32E/12345678';
const DATASHEET_URL = 'https://www.espressif.com/sites/default/files/documentation/esp32_datasheet_en.pdf';

function response(body, { status = 200, headers = {} } = {}) {
  return new Response(body, { status, headers });
}

function componentPage(overrides = {}) {
  const product = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: 'ESP32-DevKitC-32E',
    mpn: 'ESP32-DEVKITC-32E',
    brand: { '@type': 'Brand', name: 'Espressif Systems' },
    offers: { '@type': 'Offer', price: '8.90', priceCurrency: 'USD', availability: 'https://schema.org/InStock' },
    ...overrides,
  };
  return `<!doctype html><html><head><title>ESP32 DevKitC</title><script type="application/ld+json">${JSON.stringify(product)}</script></head><body><a href="${DATASHEET_URL}">Datasheet PDF</a></body></html>`;
}

function toolset(fetchImpl, extra = {}) {
  return createResearchTools({ fetch: fetchImpl, now: () => new Date(NOW), ...extra });
}

function getTool(set, id) {
  const tool = set.get(id);
  assert.ok(tool, `expected tool ${id}`);
  return tool;
}

test('exports the research tool surface and limits employee tools by explicit role capabilities', () => {
  assert.deepEqual(RESEARCH_TOOL_IDS, [
    'research.capabilities', 'research.web.search', 'research.component.search',
    'research.component.inspect', 'research.datasheet.extract', 'research.component.compare', 'research.bom.compile',
  ]);
  const researcher = researchCapabilitiesForEmployee({ professionId: 'research-analyst', skills: [] });
  assert.ok(researcher.includes('technical-research'));
  assert.ok(researcher.includes('datasheet-analysis'));
  assert.ok(!researcher.includes('component-sourcing'));
  const electrical = researchCapabilitiesForEmployee({ professionId: 'electrical-engineer', skills: [] });
  assert.ok(electrical.includes('component-sourcing'));
  assert.ok(electrical.includes('bom'));
  assert.deepEqual(researchCapabilitiesForEmployee({ professionId: 'analyst', skills: ['analysis'] }), [], 'ordinary employees do not receive Research tools automatically');
  assert.equal(filterResearchToolsByCapabilities(createResearchTools().tools, ['technical-research']).some(item => item.id === 'research.component.search'), false);
});

test('technical and component search keeps discovery snippets unverified and never invents price or stock', async () => {
  const html = `<div class="result"><a class="result__a" href="//duckduckgo.com/l/?uddg=${encodeURIComponent(PRODUCT_URL)}&amp;rut=x">ESP32 DevKitC official product</a><a class="result__snippet">Wi-Fi and Bluetooth development board, $4.99, limited stock.</a></div>`;
  const calls = [];
  const set = toolset(async (input, init) => { calls.push({ url: String(input), init }); return response(html, { headers: { 'content-type': 'text/html' } }); });
  const search = await getTool(set, 'research.web.search').execute({ query: 'ESP32 DevKitC datasheet', maxResults: 5 });
  assert.equal(search.status, 'UNVERIFIED');
  assert.equal(search.data.results[0].url, PRODUCT_URL);
  assert.match(search.data.results[0].provenance.sourceUrl, /^https:\/\/html\.duckduckgo\.com\/html\//);
  assert.equal(search.data.results[0].provenance.checkedAt, NOW);
  assert.equal(search.data.results[0].status, 'UNVERIFIED');
  assert.equal(calls[0].init.redirect, 'manual');

  const candidates = await getTool(set, 'research.component.search').execute({
    query: 'ESP32 Wi-Fi development module',
    requirements: { supplyVoltage: '3.3 V', interfaces: 'Wi-Fi, Bluetooth' },
    maxUnitPrice: 12,
    currency: 'USD',
  });
  assert.equal(candidates.status, 'UNVERIFIED');
  const item = candidates.data.candidates[0];
  assert.match(new URL(calls[1].url).searchParams.get('q'), /price below 12 USD/i);
  assert.equal(item.url.value, PRODUCT_URL);
  assert.equal(item.price.value, null);
  assert.equal(item.currency.value, null);
  assert.equal(item.availability.value, null);
  assert.equal(item.budgetAssessment, 'UNKNOWN');
  assert.equal(item.status, 'UNVERIFIED');
  assert.equal(item.name.provenance.sourceType, 'search-result');
});

test('unavailable, challenged, or rate-limited search returns BLOCKED without CAPTCHA workarounds', async () => {
  const unavailable = toolset(async () => { throw new TypeError('fetch failed'); });
  const offline = await getTool(unavailable, 'research.web.search').execute({ query: 'ESP32 datasheet' });
  assert.equal(offline.status, 'BLOCKED');
  assert.equal(offline.reasonCode, 'network_unavailable');

  const challenged = toolset(async () => response('<html><title>Just a moment</title>captcha verification required</html>', { headers: { 'content-type': 'text/html' } }));
  const captcha = await getTool(challenged, 'research.web.search').execute({ query: 'temperature sensor' });
  assert.equal(captcha.status, 'BLOCKED');
  assert.equal(captcha.reasonCode, 'challenge_or_captcha');

  const rateLimited = toolset(async () => response('rate limited', { status: 429 }));
  const limited = await getTool(rateLimited, 'research.web.search').execute({ query: 'buck converter' });
  assert.equal(limited.status, 'BLOCKED');
  assert.equal(limited.reasonCode, 'source_rate_limited');
});

test('component inspection extracts only explicit product fields with per-value price provenance', async () => {
  const set = toolset(async url => String(url) === PRODUCT_URL
    ? response(componentPage(), { headers: { 'content-type': 'text/html' } })
    : response('', { status: 404 }));
  const result = await getTool(set, 'research.component.inspect').execute({ url: PRODUCT_URL, maxUnitPrice: 10, currency: 'USD' });
  assert.equal(result.status, 'VERIFIED');
  const item = result.data.component;
  assert.equal(item.name.value, 'ESP32-DevKitC-32E');
  assert.equal(item.manufacturer.value, 'Espressif Systems');
  assert.equal(item.partNumber.value, 'ESP32-DEVKITC-32E');
  assert.equal(item.price.value, 8.9);
  assert.equal(item.currency.value, 'USD');
  assert.equal(item.availability.value, 'InStock');
  assert.equal(item.checkedAt, NOW);
  assert.equal(item.price.provenance.sourceUrl, PRODUCT_URL);
  assert.match(item.price.provenance.evidence, /8\.90 USD/);
  assert.equal(item.budgetAssessment, 'WITHIN_BUDGET');
  assert.equal(item.datasheetUrl.value, DATASHEET_URL);
  assert.equal(item.datasheetUrl.status, 'UNVERIFIED');
  assert.equal(result.data.electricalCompatibility, 'NOT_EVALUATED');
});

test('component inspection leaves locale-ambiguous prices unknown instead of guessing decimal separators', async () => {
  const set = toolset(async () => response(componentPage({ offers: { price: '2,35', priceCurrency: 'EUR', availability: 'https://schema.org/InStock' } }), { headers: { 'content-type': 'text/html' } }));
  const result = await getTool(set, 'research.component.inspect').execute({ url: PRODUCT_URL });
  assert.equal(result.data.component.price.value, null);
  assert.equal(result.data.component.currency.value, null);
  assert.equal(result.data.component.budgetAssessment, 'UNKNOWN');
});

test('component inspection blocks unsupported hosts and preserves missing price/availability as unknown', async () => {
  let requests = 0;
  const set = toolset(async url => { requests++; return response(String(url) === PRODUCT_URL ? componentPage() : '<title>Maker board</title><meta name="manufacturer" content="Maker">', { headers: { 'content-type': 'text/html' } }); });
  const blocked = await getTool(set, 'research.component.inspect').execute({ url: 'http://127.0.0.1/admin' });
  assert.equal(blocked.status, 'BLOCKED');
  assert.equal(blocked.reasonCode, 'source_not_allowlisted');
  assert.equal(requests, 0, 'unsafe URL must be rejected before fetch');

  const redirectSet = toolset(async () => new Response(null, { status: 302, headers: { location: 'https://unapproved.example/product' } }));
  const redirect = await getTool(redirectSet, 'research.component.inspect').execute({ url: PRODUCT_URL });
  assert.equal(redirect.status, 'BLOCKED');
  assert.equal(redirect.reasonCode, 'redirect_not_allowed');

  const missing = await getTool(set, 'research.component.inspect').execute({ url: 'https://www.digikey.com/product/example' });
  assert.equal(missing.status, 'NEEDS_DATASHEET');
  assert.equal(missing.data.component.price.value, null);
  assert.equal(missing.data.component.availability.value, null);
  assert.equal(missing.data.component.manufacturer.value, 'Maker');
  assert.equal(missing.data.component.manufacturer.status, 'VERIFIED');
  assert.equal(missing.data.component.price.status, 'UNVERIFIED');
});

test('datasheet extraction returns quoted, dated evidence and requests review for missing specs', async () => {
  const set = toolset(async url => String(url) === DATASHEET_URL
    ? response(new Uint8Array([37, 80, 68, 70]), { headers: { 'content-type': 'application/pdf' } })
    : response('', { status: 404 }), {
    pdfTextExtractor: async () => 'Supply voltage range: 3.0 V to 3.6 V\nOperating temperature range: -40 °C to +85 °C\n',
  });
  const result = await getTool(set, 'research.datasheet.extract').execute({ url: DATASHEET_URL, parameters: ['supplyVoltage', 'operatingTemperature', 'supplyCurrent'] });
  assert.equal(result.status, 'NEEDS_DATASHEET');
  const values = result.data.parameters;
  assert.equal(values.supplyVoltage.value, '3.0 V to 3.6 V');
  assert.equal(values.supplyVoltage.status, 'VERIFIED');
  assert.equal(values.supplyVoltage.provenance.sourceUrl, DATASHEET_URL);
  assert.match(values.supplyVoltage.provenance.evidence, /Supply voltage range/);
  assert.equal(values.supplyVoltage.provenance.page, 1);
  assert.equal(values.operatingTemperature.value, '-40 °C to +85 °C');
  assert.equal(values.supplyCurrent.value, null);
  assert.equal(values.supplyCurrent.status, 'NEEDS_DATASHEET');
  assert.equal(result.data.electricalCompatibility, 'NOT_EVALUATED');
});

test('comparison and BOM keep stale or absent commercial facts explicit and do not infer compatibility', async () => {
  let clock = new Date('2026-08-01T00:00:00.000Z');
  const set = toolset(async url => String(url) === PRODUCT_URL ? response(componentPage(), { headers: { 'content-type': 'text/html' } }) : response('', { status: 404 }), { now: () => clock });
  const inspected = await getTool(set, 'research.component.inspect').execute({ url: PRODUCT_URL });
  assert.equal(inspected.status, 'VERIFIED');
  clock = new Date(NOW);
  const swapped = { ...inspected.data.component, id: 'swapped', partNumber: inspected.data.component.name };
  const swappedFields = await getTool(set, 'research.component.compare').execute({ components: [inspected.data.component, swapped] });
  assert.equal(swappedFields.data.components.find(item => item.id === 'swapped').partNumber.value, null, 'a real evidence value cannot be relabeled as a different field');
  const forged = { id: 'forged', name: { value: 'Invented sensor', status: 'VERIFIED', provenance: { sourceUrl: 'https://fake.example/item', checkedAt: NOW } }, price: { value: 0.01, status: 'VERIFIED', provenance: { sourceUrl: 'https://fake.example/item', checkedAt: NOW } }, currency: { value: 'USD', status: 'VERIFIED', provenance: { sourceUrl: 'https://fake.example/item', checkedAt: NOW } }, url: { value: 'https://fake.example/item', status: 'VERIFIED', provenance: { sourceUrl: 'https://fake.example/item', checkedAt: NOW } }, specifications: { supplyVoltage: { value: '3.3 V', status: 'VERIFIED', provenance: { sourceUrl: 'https://fake.example/item', checkedAt: NOW } } } };
  const compare = await getTool(set, 'research.component.compare').execute({ components: [inspected.data.component, forged] });
  assert.equal(compare.status, 'OUTDATED');
  assert.equal(compare.data.electricalCompatibility, 'NOT_EVALUATED');
  assert.deepEqual(compare.data.priceComparison.comparableGroups, []);
  const stale = compare.data.components.find(item => item.id === inspected.data.component.id);
  const rejected = compare.data.components.find(item => item.id === 'forged');
  assert.equal(stale.price.status, 'OUTDATED');
  assert.equal(rejected.price.value, null, 'caller supplied VERIFIED labels and URLs are not accepted as evidence');
  assert.equal(rejected.url.value, null);
  assert.equal(compare.data.comparisons[0].comparison, 'UNKNOWN');

  const bom = await getTool(set, 'research.bom.compile').execute({ currency: 'USD', items: [
    { reference: 'U1', quantity: 1, component: rejected },
    { reference: 'U2', quantity: 2, component: stale },
  ] });
  assert.equal(bom.status, 'OUTDATED');
  assert.equal(bom.data.items[0].unitPrice, null);
  assert.equal(bom.data.items[1].priceStatus, 'OUTDATED');
  assert.equal(bom.data.items[1].fieldEvidence.price.provenance.sourceUrl, PRODUCT_URL);
  assert.equal(bom.data.items[1].fieldEvidence.manufacturer.status, 'OUTDATED');
  assert.deepEqual(bom.data.totals, []);
  assert.ok(bom.data.items.every(item => item.sourceUrls.every(url => url === PRODUCT_URL)));
});

test('task dispatcher scopes MCP tools and calls to employee capabilities and registered project metadata', async () => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'mao-research-'));
  try {
    const setOptions = { fetch: async () => response('<html></html>', { headers: { 'content-type': 'text/html' } }), now: () => new Date(NOW) };
    const electrical = createTaskResearchDispatcher({ projectId: 'project-esp32', taskId: 'task-bom', executionId: 'exec-1', workspaceRoot, employee: { id: 'employee-021', professionId: 'electrical-engineer', skills: [] }, researchOptions: setOptions });
    const analyst = createTaskResearchDispatcher({ projectId: 'project-esp32', taskId: 'task-read', executionId: 'exec-2', workspaceRoot, employee: { id: 'employee-100', professionId: 'analyst', skills: [] }, researchOptions: setOptions });
    assert.ok(electrical.tools.some(tool => tool.id === 'research.component.search'));
    assert.ok(electrical.tools.some(tool => tool.id === 'research.datasheet.extract'));
    assert.ok(!analyst.tools.some(tool => tool.id === 'research.component.search'));
    assert.deepEqual(electrical.mcpServer.allowedTools, electrical.tools.map(tool => tool.id));
    assert.deepEqual(electrical.mcpServer.approvedToolIds, undefined, 'open-world internet tools must not be added to the existing auto-approval allowlist');
    assert.equal(electrical.mcpServer.name, 'mao_research');
    const narrowMcp = createResearchMcpHandlers({
      projectId: 'project-esp32', taskId: 'task-read', executionId: 'exec-read', workspaceRoot,
      employee: { id: 'employee-021', professionId: 'electrical-engineer', skills: [] },
      employeeCapabilities: ['research'], allowedToolIds: ['research.capabilities'],
    });
    const narrowList = await narrowMcp.handle({ jsonrpc: '2.0', id: 10, method: 'tools/list', params: {} });
    assert.deepEqual(narrowList.result.tools.map(tool => tool.name), ['research.capabilities']);
    const deniedCall = await narrowMcp.handle({ jsonrpc: '2.0', id: 11, method: 'tools/call', params: { name: 'research.component.search', arguments: { query: 'ESP32' } } });
    assert.equal(deniedCall.error.code, -32602);
    const protocolInput = [
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } },
      { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
      { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'research.capabilities', arguments: {} } },
      { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'research.hidden', arguments: {} } },
    ].map(request => JSON.stringify(request)).join('\n') + '\n';
    const protocolOutput = execFileSync(electrical.mcpServer.command, electrical.mcpServer.args, { encoding: 'utf8', input: protocolInput, timeout: 5_000 });
    const protocolResponses = protocolOutput.trim().split('\n').map(line => JSON.parse(line));
    const advertised = protocolResponses.find(item => item.id === 2).result.tools.map(item => item.name);
    assert.ok(advertised.includes('research.component.search'));
    assert.ok(advertised.includes('research.bom.compile'));
    assert.equal(protocolResponses.find(item => item.id === 3).result.structuredContent.status, 'VERIFIED');
    assert.equal(protocolResponses.find(item => item.id === 4).error.code, -32602);
    const capabilities = await electrical.invoke('research.capabilities', {});
    assert.equal(capabilities.status, 'VERIFIED');
    await assert.rejects(analyst.invoke('research.component.search', { query: 'ESP32' }), error => error.code === 'tool_not_allowed');
    assert.equal(analyst.workspaceRoot, workspaceRoot);
    assert.equal(electrical.projectId, 'project-esp32');
    assert.equal(electrical.taskId, 'task-bom');
    assert.equal(electrical.executionId, 'exec-1');
    assert.deepEqual(analyst.tools.map(tool => tool.id), []);
  } finally { rmSync(workspaceRoot, { recursive: true, force: true }); }
});

