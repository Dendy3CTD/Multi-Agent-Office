import { randomUUID } from 'node:crypto';
import { realpathSync, statSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RuntimeMcpServerConfig, ToolDefinition, ToolSummary } from '@mao-hybrid/contracts';

export const RESEARCH_TOOL_IDS = Object.freeze([
  'research.capabilities',
  'research.web.search',
  'research.component.search',
  'research.component.inspect',
  'research.datasheet.extract',
  'research.component.compare',
  'research.bom.compile',
] as const);

export type ResearchStatus = 'VERIFIED' | 'UNVERIFIED' | 'NEEDS_DATASHEET' | 'OUTDATED' | 'BLOCKED';
export type ResearchCapability = 'research' | 'technical-research' | 'component-sourcing' | 'datasheet-analysis' | 'bom';
export type ResearchSourceType = 'search-result' | 'manufacturer-page' | 'distributor-page' | 'datasheet';

export interface ResearchProvenance {
  readonly sourceType: ResearchSourceType;
  readonly sourceUrl: string;
  readonly sourceName: string;
  readonly checkedAt: string;
  readonly extraction: string;
  readonly evidence: string;
  readonly page?: number;
  /** Opaque per-dispatcher evidence handle; downstream tools reject changed/forged values. */
  readonly evidenceId?: string;
}
export interface SourcedValue<T> {
  readonly value: T | null;
  readonly status: ResearchStatus;
  readonly provenance?: ResearchProvenance;
  readonly reason?: string;
}

export interface ResearchComponent {
  readonly id: string;
  readonly name: SourcedValue<string>;
  readonly manufacturer: SourcedValue<string>;
  readonly partNumber: SourcedValue<string>;
  readonly url: SourcedValue<string>;
  readonly currency: SourcedValue<string>;
  readonly price: SourcedValue<number>;
  readonly availability: SourcedValue<string>;
  readonly datasheetUrl: SourcedValue<string>;
  readonly checkedAt: string;
  readonly status: ResearchStatus;
  readonly budgetAssessment: 'WITHIN_BUDGET' | 'OVER_BUDGET' | 'UNKNOWN';
  readonly specifications: Readonly<Record<string, SourcedValue<string | number | boolean>>>;
}

export interface ResearchToolResult<T = unknown> {
  readonly toolId: string;
  readonly status: ResearchStatus;
  readonly checkedAt: string;
  readonly data?: T;
  readonly reasonCode?: string;
  readonly message?: string;
  readonly warnings?: readonly string[];
}

export interface ResearchFetchOptions {
  readonly fetch?: typeof fetch;
  readonly now?: () => Date;
  readonly timeoutMs?: number;
  readonly maxHtmlBytes?: number;
  readonly maxPdfBytes?: number;
  readonly maxTextBytes?: number;
  readonly maxSourceAgeDays?: number;
  /** Test seam; production defaults to the local `pdftotext` executable. */
  readonly pdfTextExtractor?: (pdf: Uint8Array, options: { readonly timeoutMs: number; readonly maxOutputBytes: number }) => Promise<string>;
}

export interface ResearchToolsOptions extends ResearchFetchOptions {}
export interface ResearchEmployee { readonly id?: string; readonly professionId: string; readonly skills: readonly string[]; }

export interface ResearchTaskDispatcher {
  readonly projectId: string;
  readonly taskId: string;
  readonly executionId: string;
  readonly workspaceRoot: string;
  readonly employee: ResearchEmployee;
  readonly tools: readonly ResearchTool[];
  readonly summaries: readonly ToolSummary[];
  readonly mcpServer: RuntimeMcpServerConfig;
  invoke(toolId: string, input: unknown): Promise<ResearchToolResult>;
}

type ResearchTool = ToolDefinition<Record<string, unknown>, ResearchToolResult>;
type FetchFailureCode = 'network_unavailable' | 'source_rate_limited' | 'source_access_denied' | 'source_unavailable' | 'source_not_allowlisted' | 'redirect_not_allowed' | 'source_too_large' | 'unsupported_content_type' | 'challenge_or_captcha' | 'request_timeout' | 'invalid_source_url';
interface FetchFailure { readonly code: FetchFailureCode; readonly message: string; }
interface FetchedDocument { readonly url: string; readonly contentType: string; readonly bytes: Uint8Array; readonly text?: string; }
interface EvidenceRecord { readonly value: string; readonly sourceUrl: string; readonly checkedAt: string; readonly status: ResearchStatus; readonly extraction: string; }

const SEARCH_HOSTS = ['html.duckduckgo.com', 'duckduckgo.com'] as const;
const SOURCE_HOSTS = [
  'espressif.com', 'ti.com', 'analog.com', 'st.com', 'microchip.com', 'nxp.com', 'infineon.com', 'onsemi.com',
  'bosch-sensortec.com', 'sensirion.com', 'murata.com', 'honeywell.com', 'ams-osram.com', 'semtech.com', 'silabs.com',
  'digikey.com', 'mouser.com', 'lcsc.com', 'tme.eu', 'farnell.com', 'newark.com', 'rs-online.com', 'reichelt.com',
  'adafruit.com', 'sparkfun.com',
] as const;
const MANUFACTURER_HOSTS = [
  'espressif.com', 'ti.com', 'analog.com', 'st.com', 'microchip.com', 'nxp.com', 'infineon.com', 'onsemi.com',
  'bosch-sensortec.com', 'sensirion.com', 'murata.com', 'honeywell.com', 'ams-osram.com', 'semtech.com', 'silabs.com',
  'adafruit.com', 'sparkfun.com',
] as const;
const DEFAULT_TIMEOUT_MS = 12_000;
const MAX_HTML_BYTES = 2 * 1024 * 1024;
const MAX_PDF_BYTES = 18 * 1024 * 1024;
const MAX_TEXT_BYTES = 4 * 1024 * 1024;
const DEFAULT_MAX_SOURCE_AGE_DAYS = 30;
const TOOL_CAPABILITIES: Readonly<Record<(typeof RESEARCH_TOOL_IDS)[number], readonly ResearchCapability[]>> = Object.freeze({
  'research.capabilities': ['research'],
  'research.web.search': ['technical-research'],
  'research.component.search': ['component-sourcing'],
  'research.component.inspect': ['component-sourcing'],
  'research.datasheet.extract': ['datasheet-analysis'],
  'research.component.compare': ['component-sourcing'],
  'research.bom.compile': ['bom'],
});
const SOURCE_VALUE_FIELDS = ['name', 'manufacturer', 'partNumber', 'url', 'currency', 'price', 'availability', 'datasheetUrl'] as const;
const COMPONENT_SOURCE_EXTRACTIONS: Readonly<Record<(typeof SOURCE_VALUE_FIELDS)[number], readonly string[]>> = Object.freeze({
  name: ['schema.org-product.name', 'meta:og:title', 'meta:twitter:title', 'html:title', 'search-result-title-and-snippet'],
  manufacturer: ['schema.org-product.manufacturer', 'schema.org-product.brand', 'meta:manufacturer', 'meta:brand'],
  partNumber: ['schema.org-product.mpn', 'schema.org-product.sku', 'meta:mpn', 'meta:product:retailer_item_id'],
  url: ['final-allowlisted-page-url', 'search-result-url'],
  currency: ['schema.org-offer.priceCurrency', 'meta:product:price:currency', 'meta:og:price:currency'],
  price: ['schema.org-offer.price', 'meta:product:price:amount', 'meta:og:price:amount'],
  availability: ['schema.org-offer.availability', 'meta:product:availability', 'meta:availability'],
  datasheetUrl: ['datasheet-link-discovery'],
});
const DEFAULT_EXTRACTION_PARAMETERS = ['supplyVoltage', 'supplyCurrent', 'operatingTemperature', 'interface', 'gpioCount', 'package', 'sensorRange', 'accuracy'] as const;

export function researchCapabilitiesForEmployee(employee: ResearchEmployee): readonly ResearchCapability[] {
  const capabilities = new Set(employee.skills.filter(isResearchCapability));
  if (['researcher', 'research-analyst', 'technical-analyst'].includes(employee.professionId)) {
    capabilities.add('research');
    capabilities.add('technical-research');
    capabilities.add('datasheet-analysis');
  }
  if (['electronics-engineer', 'electrical-engineer', 'embedded-engineer'].includes(employee.professionId)) {
    capabilities.add('research');
    capabilities.add('technical-research');
    capabilities.add('component-sourcing');
    capabilities.add('datasheet-analysis');
    capabilities.add('bom');
  }
  return Object.freeze([...capabilities]);
}

export function filterResearchToolsByCapabilities(tools: readonly ResearchTool[], capabilities: readonly string[]): readonly ResearchTool[] {
  const selected = new Set(capabilities);
  return tools.filter(tool => (tool.capabilities ?? []).some(capability => selected.has(capability)));
}

export function createResearchTools(options: ResearchToolsOptions = {}): { readonly tools: readonly ResearchTool[]; get(id: string): ResearchTool | undefined } {
  const fetcher = options.fetch ?? globalThis.fetch;
  const now = options.now ?? (() => new Date());
  const timeoutMs = boundedInteger(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, 500, 60_000, 'timeoutMs');
  const maxHtmlBytes = boundedInteger(options.maxHtmlBytes ?? MAX_HTML_BYTES, 1024, MAX_HTML_BYTES, 'maxHtmlBytes');
  const maxPdfBytes = boundedInteger(options.maxPdfBytes ?? MAX_PDF_BYTES, 1024, MAX_PDF_BYTES, 'maxPdfBytes');
  const maxTextBytes = boundedInteger(options.maxTextBytes ?? MAX_TEXT_BYTES, 1024, MAX_TEXT_BYTES, 'maxTextBytes');
  const maxSourceAgeDays = boundedInteger(options.maxSourceAgeDays ?? DEFAULT_MAX_SOURCE_AGE_DAYS, 1, 3650, 'maxSourceAgeDays');
  const pdfTextExtractor = options.pdfTextExtractor ?? extractPdfText;
  const evidence = new Map<string, EvidenceRecord>();
  const tools: ResearchTool[] = [];

  const add = (id: (typeof RESEARCH_TOOL_IDS)[number], name: string, description: string, schema: Record<string, unknown>, run: (input: Record<string, unknown>) => Promise<ResearchToolResult> | ResearchToolResult, openWorldHint = true) => {
    const capabilities = TOOL_CAPABILITIES[id];
    tools.push(Object.freeze({
      id, name, description, inputSchema: Object.freeze({ ...schema, 'x-mao-capabilities': capabilities }), capabilities,
      annotations: Object.freeze({ readOnlyHint: true, destructiveHint: false, openWorldHint }),
      async execute(input: Record<string, unknown>) { return await run(asRecord(input)); },
    }));
  };

  const provenance = (sourceType: ResearchSourceType, sourceUrl: string, sourceName: string, checkedAt: string, extraction: string, evidenceText: string, page?: number) => ({
    sourceType, sourceUrl, sourceName, checkedAt, extraction, evidence: evidenceText.slice(0, 600), ...(page ? { page } : {}),
  });
  const sourced = <T>(value: T | null, status: ResearchStatus, source?: ResearchProvenance, reason?: string): SourcedValue<T> => {
    if (value === null || !source) return { value, status, ...(reason ? { reason } : {}) };
    const evidenceId = randomUUID();
    evidence.set(evidenceId, { value: stableJson(value), sourceUrl: source.sourceUrl, checkedAt: source.checkedAt, status, extraction: source.extraction });
    return { value, status, provenance: { ...source, evidenceId }, ...(reason ? { reason } : {}) };
  };
  const sourceFreshness = (value: unknown, checkedAt: unknown): ResearchStatus => {
    if (typeof checkedAt !== 'string') return 'UNVERIFIED';
    const timestamp = Date.parse(checkedAt);
    if (!Number.isFinite(timestamp)) return 'UNVERIFIED';
    return now().getTime() - timestamp > maxSourceAgeDays * 86_400_000 ? 'OUTDATED' : 'VERIFIED';
  };
  const trustInputValue = <T>(raw: unknown, expected: (value: unknown) => value is T, expectedExtractions?: readonly string[]): SourcedValue<T> => {
    if (!isRecord(raw) || !expected(raw.value) || !isRecord(raw.provenance)) {
      return { value: null, status: 'UNVERIFIED', reason: 'No tool-issued evidence was supplied.' };
    }
    const value = raw.value;
    const source = raw.provenance;
    const checkedAt = typeof source.checkedAt === 'string' ? source.checkedAt : undefined;
    const sourceUrl = typeof source.sourceUrl === 'string' ? source.sourceUrl : undefined;
    const evidenceId = typeof source.evidenceId === 'string' ? source.evidenceId : undefined;
    const extraction = typeof source.extraction === 'string' ? source.extraction : undefined;
    const issued = evidenceId ? evidence.get(evidenceId) : undefined;
    if (!issued || issued.value !== stableJson(value) || issued.sourceUrl !== sourceUrl || issued.checkedAt !== checkedAt || issued.extraction !== extraction || (expectedExtractions && (!extraction || !expectedExtractions.includes(extraction)))) {
      return { value: null, status: 'UNVERIFIED', reason: 'Evidence handle is missing, expired, or does not match the supplied value.' };
    }
    const age = sourceFreshness(value, checkedAt);
    if (age === 'OUTDATED') return { value, status: 'OUTDATED', provenance: safeProvenance(source) };
    return { value, status: issued.status, provenance: safeProvenance(source) };
  };
  const fetchDocument = (url: string, hosts: readonly string[], maxBytes: number) => fetchBoundedDocument(fetcher, url, hosts, maxBytes, timeoutMs);

  add('research.capabilities', 'Research capabilities', 'List research and component-sourcing capabilities available from this package.', { type: 'object', additionalProperties: false, properties: {} }, () => ok('research.capabilities', {
    capabilities: [...new Set(Object.values(TOOL_CAPABILITIES).flat())], toolIds: [...RESEARCH_TOOL_IDS],
    notes: ['Search snippets are discovery leads, not verified specifications.', 'Electrical compatibility is never inferred from marketing copy.'],
  }, now), false);

  add('research.web.search', 'Search technical sources', 'Search public technical web results. Results are unverified leads until their original source is checked.', {
    type: 'object', additionalProperties: false, required: ['query'], properties: { query: { type: 'string', minLength: 2, maxLength: 240 }, maxResults: { type: 'integer', minimum: 1, maximum: 10 } },
  }, async input => {
    const query = boundedText(input.query, 2, 240, 'query');
    const maxResults = boundedInteger(input.maxResults ?? 8, 1, 10, 'maxResults');
    const search = await querySearch(query, maxResults, fetchDocument, now);
    if (!search.ok) return blocked('research.web.search', search.failure, now);
    const results = search.results.map((item, index) => ({
      id: `search-${index + 1}`, title: item.title, url: item.url, snippet: item.snippet, status: 'UNVERIFIED' as const,
      provenance: provenance('search-result', search.searchUrl, 'DuckDuckGo HTML search', search.checkedAt, 'search-result-title-and-snippet', `${item.title}\n${item.snippet}`),
    }));
    return { toolId: 'research.web.search', status: results.length ? 'UNVERIFIED' : 'NEEDS_DATASHEET', checkedAt: search.checkedAt, data: { query, results, note: 'Search metadata is not proof of a specification, price, stock, or electrical compatibility.' }, ...(results.length ? {} : { message: 'No indexed results returned for this query.' }) };
  });

  add('research.component.search', 'Find component candidates', 'Find candidate product pages by component keywords, requested characteristics, and a budget search hint; unpriced candidates remain budget UNKNOWN.', {
    type: 'object', additionalProperties: false, required: ['query'], properties: {
      query: { type: 'string', minLength: 2, maxLength: 180 }, category: { type: 'string', maxLength: 80 },
      requirements: { type: 'object', additionalProperties: { type: ['string', 'number', 'boolean'] } },
      maxUnitPrice: { type: 'number', minimum: 0 }, currency: { type: 'string', pattern: '^[A-Z]{3}$' }, maxResults: { type: 'integer', minimum: 1, maximum: 10 },
    },
  }, async input => {
    const query = boundedText(input.query, 2, 180, 'query');
    const category = input.category === undefined ? '' : boundedText(input.category, 1, 80, 'category');
    const requirements = normalizeRequirements(input.requirements);
    const budget = parseBudget(input.maxUnitPrice, input.currency);
    const budgetTerms = budget.maxUnitPrice === null ? [] : [`price below ${budget.maxUnitPrice}${budget.currency ? ` ${budget.currency}` : ''}`];
    const terms = [query, category, ...Object.entries(requirements).map(([key, value]) => `${key} ${value}`), ...budgetTerms, 'datasheet component distributor'].filter(Boolean).join(' ');
    const search = await querySearch(terms, boundedInteger(input.maxResults ?? 8, 1, 10, 'maxResults'), fetchDocument, now);
    if (!search.ok) return blocked('research.component.search', search.failure, now);
    const candidates: ResearchComponent[] = search.results.map((item, index) => {
      const source = provenance('search-result', search.searchUrl, 'DuckDuckGo HTML search', search.checkedAt, 'search-result-title-and-snippet', `${item.title}\n${item.snippet}`);
      const productSource = provenance('search-result', search.searchUrl, 'DuckDuckGo HTML search', search.checkedAt, 'search-result-url', item.url);
      const identity = sourced(item.title || null, 'UNVERIFIED', source, 'Search result title is not an official product identity.');
      return {
        id: `candidate-${index + 1}`, name: identity, manufacturer: sourced<string>(null, 'UNVERIFIED', undefined, 'Not read from a manufacturer or distributor product page.'),
        partNumber: sourced<string>(null, 'UNVERIFIED', undefined, 'No exact manufacturer part number was verified.'),
        url: sourced(item.url, 'UNVERIFIED', productSource, 'Discovered URL has not been fetched or validated as a product page.'),
        currency: sourced<string>(null, 'UNVERIFIED', undefined, 'Search snippets are not accepted as price evidence.'),
        price: sourced<number>(null, 'UNVERIFIED', undefined, 'No current unit price was verified.'),
        availability: sourced<string>(null, 'UNVERIFIED', undefined, 'No current stock status was verified.'),
        datasheetUrl: sourced<string>(null, 'NEEDS_DATASHEET', undefined, 'Inspect the official component source to locate a datasheet.'),
        checkedAt: search.checkedAt, status: 'UNVERIFIED', budgetAssessment: 'UNKNOWN', specifications: {},
      };
    });
    return { toolId: 'research.component.search', status: candidates.length ? 'UNVERIFIED' : 'NEEDS_DATASHEET', checkedAt: search.checkedAt, data: { query, requirements, budget, candidates, note: 'Search candidates are not asserted to meet requirements; verify exact orderable part numbers and datasheets.' } };
  });

  add('research.component.inspect', 'Inspect a product source', 'Read an allowlisted manufacturer or distributor product page for explicit product identity, offer, stock, and datasheet links.', {
    type: 'object', additionalProperties: false, required: ['url'], properties: { url: { type: 'string', format: 'uri', maxLength: 2048 }, maxUnitPrice: { type: 'number', minimum: 0 }, currency: { type: 'string', pattern: '^[A-Z]{3}$' } },
  }, async input => {
    const requestedUrl = boundedText(input.url, 9, 2048, 'url');
    const budget = parseBudget(input.maxUnitPrice, input.currency);
    const fetched = await fetchDocument(requestedUrl, SOURCE_HOSTS, maxHtmlBytes);
    if (!fetched.ok) return blocked('research.component.inspect', fetched.failure, now);
    if (!isHtmlContentType(fetched.document.contentType)) return blocked('research.component.inspect', { code: 'unsupported_content_type', message: 'Product inspection needs a public HTML product page.' }, now);
    const checkedAt = now().toISOString();
    const html = fetched.document.text ?? '';
    if (hasChallenge(html)) return blocked('research.component.inspect', { code: 'challenge_or_captcha', message: 'The source returned an access challenge; no challenge or CAPTCHA was bypassed.' }, now);
    const parsed = parseProductPage(html, fetched.document.url);
    const sourceType: ResearchSourceType = isManufacturerHost(new URL(fetched.document.url).hostname) ? 'manufacturer-page' : 'distributor-page';
    const make = <T>(value: T | null, extraction: string, evidenceText: string, reason?: string) => sourced(value, value === null ? 'UNVERIFIED' : 'VERIFIED', value === null ? undefined : provenance(sourceType, fetched.document.url, hostLabel(fetched.document.url), checkedAt, extraction, evidenceText), reason);
    const priceSource = parsed.price !== null && parsed.currency && parsed.priceExtraction ? provenance(sourceType, fetched.document.url, hostLabel(fetched.document.url), checkedAt, parsed.priceExtraction, `${parsed.priceText} ${parsed.currency}`) : undefined;
    const availabilitySource = parsed.availability && parsed.availabilityExtraction ? provenance(sourceType, fetched.document.url, hostLabel(fetched.document.url), checkedAt, parsed.availabilityExtraction, parsed.availabilityEvidence ?? parsed.availability) : undefined;
    const datasheetSource = parsed.datasheetUrl ? provenance(sourceType, fetched.document.url, hostLabel(fetched.document.url), checkedAt, 'datasheet-link-discovery', parsed.datasheetEvidence ?? parsed.datasheetUrl) : undefined;
    const component: ResearchComponent = {
      id: stableComponentId(fetched.document.url),
      name: make(parsed.name, parsed.nameExtraction ?? 'not-found', parsed.nameEvidence ?? '', 'No explicit product title was found.'),
      manufacturer: make(parsed.manufacturer, parsed.manufacturerExtraction ?? 'not-found', parsed.manufacturerEvidence ?? '', 'Manufacturer name was not explicitly available on the product page.'),
      partNumber: make(parsed.partNumber, parsed.partNumberExtraction ?? 'not-found', parsed.partNumberEvidence ?? '', 'Exact manufacturer part number was not explicitly available.'),
      url: make(fetched.document.url, 'final-allowlisted-page-url', fetched.document.url),
      currency: make(parsed.currency, parsed.currencyExtraction ?? 'not-found', parsed.currency ?? '', 'No explicit ISO currency was found beside a unit price.'),
      price: parsed.price !== null && priceSource ? sourced(parsed.price, 'VERIFIED', priceSource) : sourced<number>(null, 'UNVERIFIED', undefined, 'No explicit current unit price was found; no price has been inferred.'),
      availability: parsed.availability && availabilitySource ? sourced(parsed.availability, 'VERIFIED', availabilitySource) : sourced<string>(null, 'UNVERIFIED', undefined, 'No explicit stock/availability value was found.'),
      datasheetUrl: parsed.datasheetUrl && datasheetSource ? sourced(parsed.datasheetUrl, 'UNVERIFIED', datasheetSource, 'Link discovered on the product page; fetch and verify the datasheet separately.') : sourced<string>(null, 'NEEDS_DATASHEET', undefined, 'No datasheet link was found on the product page.'),
      checkedAt, status: parsed.datasheetUrl ? (parsed.name && parsed.partNumber && parsed.manufacturer ? 'VERIFIED' : 'UNVERIFIED') : 'NEEDS_DATASHEET',
      budgetAssessment: assessBudget(parsed.price, parsed.currency, budget), specifications: {},
    };
    return { toolId: 'research.component.inspect', status: component.status, checkedAt, data: { component, budget, electricalCompatibility: 'NOT_EVALUATED', note: 'Listing values describe the fetched seller page at checkedAt. They do not prove datasheet authenticity, fit, or electrical compatibility.' } };
  });

  add('research.datasheet.extract', 'Extract datasheet evidence', 'Fetch an HTTPS datasheet from an allowlisted manufacturer domain and return explicitly quoted parameter matches with page provenance.', {
    type: 'object', additionalProperties: false, required: ['url'], properties: {
      url: { type: 'string', format: 'uri', maxLength: 2048 }, parameters: { type: 'array', maxItems: 16, items: { enum: DEFAULT_EXTRACTION_PARAMETERS } },
    },
  }, async input => {
    const requestedUrl = boundedText(input.url, 9, 2048, 'url');
    const urlCheck = validateSourceUrl(requestedUrl, MANUFACTURER_HOSTS);
    if (!urlCheck.ok) return blocked('research.datasheet.extract', { code: 'invalid_source_url', message: urlCheck.message }, now);
    const fetched = await fetchDocument(requestedUrl, MANUFACTURER_HOSTS, maxPdfBytes);
    if (!fetched.ok) return blocked('research.datasheet.extract', fetched.failure, now);
    const checkedAt = now().toISOString();
    let text: string;
    if (isPdfContentType(fetched.document.contentType) || fetched.document.url.toLowerCase().endsWith('.pdf')) {
      try { text = await pdfTextExtractor(fetched.document.bytes, { timeoutMs, maxOutputBytes: maxTextBytes }); }
      catch (error) { return blocked('research.datasheet.extract', { code: 'unsupported_content_type', message: error instanceof Error ? `PDF text extraction unavailable: ${error.message}` : 'PDF text extraction unavailable.' }, now); }
    } else if (isHtmlContentType(fetched.document.contentType) || fetched.document.contentType.startsWith('text/')) {
      text = htmlToText(fetched.document.text ?? new TextDecoder().decode(fetched.document.bytes));
    } else {
      return blocked('research.datasheet.extract', { code: 'unsupported_content_type', message: 'Source is neither a PDF datasheet nor an HTML/text manufacturer document.' }, now);
    }
    if (hasChallenge(text)) return blocked('research.datasheet.extract', { code: 'challenge_or_captcha', message: 'The source returned an access challenge; no challenge or CAPTCHA was bypassed.' }, now);
    if (new TextEncoder().encode(text).length > maxTextBytes) text = text.slice(0, maxTextBytes);
    const parameters = parseParameterList(input.parameters);
    const extracted: Record<string, SourcedValue<string | number | boolean>> = {};
    const pages = text.split('\f');
    for (const parameter of parameters) {
      const match = findParameter(parameter, pages);
      if (!match) {
        extracted[parameter] = { value: null, status: 'NEEDS_DATASHEET', reason: 'No unambiguous value matched the requested datasheet field; inspect the source manually.' };
        continue;
      }
      const source = provenance('datasheet', fetched.document.url, hostLabel(fetched.document.url), checkedAt, `datasheet-parameter:${parameter}`, match.evidence, match.page);
      extracted[parameter] = sourced(match.value, 'VERIFIED', source);
    }
    const allFound = Object.values(extracted).every(value => value.value !== null);
    return {
      toolId: 'research.datasheet.extract', status: allFound ? 'VERIFIED' : 'NEEDS_DATASHEET', checkedAt,
      data: { url: fetched.document.url, parameters: extracted, electricalCompatibility: 'NOT_EVALUATED', note: 'Values are quoted from the cited document. This extraction does not evaluate system-level compatibility or safety.' },
    };
  });

  add('research.component.compare', 'Compare component alternatives', 'Compare exact sourced fields across candidate components. Missing, stale, or untrusted values remain explicit; electrical compatibility is never inferred.', {
    type: 'object', additionalProperties: false, required: ['components'], properties: { components: { type: 'array', minItems: 2, maxItems: 12, items: { type: 'object' } } },
  }, input => {
    const components = parseComponents(input.components, trustInputValue, now);
    const comparisons = compareSpecifications(components);
    const stale = components.some(component => component.status === 'OUTDATED');
    const verified = components.every(component => component.status === 'VERIFIED');
    return {
      toolId: 'research.component.compare', status: stale ? 'OUTDATED' : verified ? 'VERIFIED' : 'UNVERIFIED', checkedAt: now().toISOString(),
      data: { components, comparisons, priceComparison: compareOffers(components), electricalCompatibility: 'NOT_EVALUATED', note: 'Comparison reports sourced field equality/differences only; engineering compatibility requires exact datasheet limits and qualified review.' },
    };
  }, false);

  add('research.bom.compile', 'Compile sourced BOM rows', 'Compile a structured, non-purchasing BOM. Only current tool-issued prices with matching currency are totaled.', {
    type: 'object', additionalProperties: false, required: ['items'], properties: {
      currency: { type: 'string', pattern: '^[A-Z]{3}$' }, items: { type: 'array', minItems: 1, maxItems: 200, items: { type: 'object', required: ['reference', 'quantity', 'component'] } },
    },
  }, input => {
    const items = parseBomItems(input.items, trustInputValue);
    const currency = typeof input.currency === 'string' && /^[A-Z]{3}$/.test(input.currency) ? input.currency : undefined;
    const totals = new Map<string, number>();
    for (const item of items) {
      if (item.unitPrice !== null && item.priceStatus === 'VERIFIED' && item.currency && (!currency || currency === item.currency)) {
        totals.set(item.currency, (totals.get(item.currency) ?? 0) + item.unitPrice * item.quantity);
      }
    }
    const stale = items.some(item => item.status === 'OUTDATED');
    const complete = items.every(item => item.status === 'VERIFIED');
    return {
      toolId: 'research.bom.compile', status: stale ? 'OUTDATED' : complete ? 'VERIFIED' : 'UNVERIFIED', checkedAt: now().toISOString(),
      data: {
        currency: currency ?? null, items, totals: [...totals].map(([unit, amount]) => ({ currency: unit, total: roundMoney(amount) })),
        purchasingPerformed: false, electricalCompatibility: 'NOT_EVALUATED',
        note: 'Unknown and stale prices are excluded from totals. BOM compilation never places orders or estimates missing values.',
      },
    };
  }, false);

  return Object.freeze({ tools: Object.freeze(tools), get: (id: string) => tools.find(tool => tool.id === id) });
}

export function createTaskResearchDispatcher(options: {
  readonly projectId: string;
  readonly taskId: string;
  readonly executionId: string;
  readonly workspaceRoot: string;
  readonly employee: ResearchEmployee;
  readonly researchOptions?: ResearchToolsOptions;
}): ResearchTaskDispatcher {
  for (const [key, value] of Object.entries({ projectId: options.projectId, taskId: options.taskId, executionId: options.executionId })) {
    if (typeof value !== 'string' || !value.trim() || value.length > 160) throw new TypeError(`${key} must be a non-empty identifier`);
  }
  if (!isAbsolute(options.workspaceRoot)) throw new TypeError('workspaceRoot must be an absolute registered project path');
  const workspaceRoot = realpathSync(options.workspaceRoot);
  if (!statSync(workspaceRoot).isDirectory()) throw new TypeError('workspaceRoot must be a directory');
  const capabilities = researchCapabilitiesForEmployee(options.employee);
  const toolset = createResearchTools(options.researchOptions);
  const tools = filterResearchToolsByCapabilities(toolset.tools, capabilities);
  const allowed = new Map(tools.map(tool => [tool.id, tool]));
  const serverPath = fileURLToPath(new URL('./mcp-server.js', import.meta.url));
  const launch = {
    projectId: options.projectId, taskId: options.taskId, executionId: options.executionId, workspaceRoot,
    employee: { id: options.employee.id, professionId: options.employee.professionId, skills: options.employee.skills },
    employeeCapabilities: capabilities, allowedToolIds: [...allowed.keys()],
  };
  const mcpServer: RuntimeMcpServerConfig = Object.freeze({
    name: 'mao_research', command: process.execPath, args: Object.freeze([serverPath, JSON.stringify(launch)]),
    allowedTools: Object.freeze([...allowed.keys()]),
    // Search and product-page tools are open-world network reads. The package does not extend Codex auto-approval.
  });
  return Object.freeze({
    projectId: options.projectId, taskId: options.taskId, executionId: options.executionId, workspaceRoot, employee: options.employee,
    tools: Object.freeze([...tools]),
    summaries: Object.freeze(tools.map(({ id, name, description, inputSchema, capabilities: toolCapabilities, annotations }) => Object.freeze({ id, name, description, inputSchema, capabilities: toolCapabilities, ...(annotations ? { annotations } : {}) }))),
    mcpServer,
    async invoke(toolId: string, input: unknown) {
      const tool = allowed.get(toolId);
      if (!tool) throw Object.assign(new Error(`Research tool ${toolId} is not available to ${options.employee.id ?? options.employee.professionId}`), { code: 'tool_not_allowed' });
      return await tool.execute(asRecord(input));
    },
  });
}

export function listResearchToolSummaries(): readonly ToolSummary[] {
  const toolset = createResearchTools();
  return Object.freeze(toolset.tools.map(({ id, name, description, inputSchema, capabilities, annotations }) => Object.freeze({ id, name, description, inputSchema, ...(capabilities ? { capabilities } : {}), ...(annotations ? { annotations } : {}) })));
}

async function querySearch(query: string, maxResults: number, fetchDocument: (url: string, hosts: readonly string[], bytes: number) => ReturnType<typeof fetchBoundedDocument>, now: () => Date): Promise<{ ok: true; searchUrl: string; checkedAt: string; results: Array<{ title: string; url: string; snippet: string }> } | { ok: false; failure: FetchFailure }> {
  const searchUrl = new URL('https://html.duckduckgo.com/html/');
  searchUrl.searchParams.set('q', query);
  searchUrl.searchParams.set('kl', 'us-en');
  const fetched = await fetchDocument(searchUrl.toString(), SEARCH_HOSTS, MAX_HTML_BYTES);
  if (!fetched.ok) return fetched;
  if (!isHtmlContentType(fetched.document.contentType)) return { ok: false, failure: { code: 'unsupported_content_type', message: 'Search provider did not return HTML.' } };
  const html = fetched.document.text ?? '';
  if (hasChallenge(html)) return { ok: false, failure: { code: 'challenge_or_captcha', message: 'Search provider returned a challenge/CAPTCHA. No bypass was attempted.' } };
  const anchors = [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi)].flatMap(match => {
    const attrs = parseAttributes(match[1]);
    if (!String(attrs.class ?? '').split(/\s+/).includes('result__a') || !attrs.href) return [];
    const decoded = decodeSearchUrl(decodeHtml(attrs.href));
    if (!validSearchResultUrl(decoded)) return [];
    return [{ title: cleanText(match[2]), url: decoded }];
  }).slice(0, maxResults);
  const snippets = [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi)].flatMap(match => {
    const attrs = parseAttributes(match[1]);
    return String(attrs.class ?? '').split(/\s+/).includes('result__snippet') ? [cleanText(match[2])] : [];
  });
  return { ok: true, searchUrl: fetched.document.url, checkedAt: now().toISOString(), results: anchors.map((item, index) => ({ ...item, snippet: snippets[index] ?? '' })) };
}

async function fetchBoundedDocument(fetcher: typeof fetch, rawUrl: string, hosts: readonly string[], maxBytes: number, timeoutMs: number): Promise<{ ok: true; document: FetchedDocument } | { ok: false; failure: FetchFailure }> {
  let current: URL;
  try { current = new URL(rawUrl); } catch { return { ok: false, failure: { code: 'invalid_source_url', message: 'Source URL is invalid.' } }; }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    for (let redirects = 0; redirects <= 3; redirects++) {
      const validation = validateSourceUrl(current.toString(), hosts);
      if (!validation.ok) return { ok: false, failure: { code: redirects === 0 ? classifySourceUrlFailure(current, hosts) : 'redirect_not_allowed', message: validation.message } };
      const response = await fetcher(current.toString(), { method: 'GET', redirect: 'manual', signal: controller.signal, headers: { accept: 'text/html,application/xhtml+xml,application/pdf,text/plain;q=0.9,*/*;q=0.1', 'user-agent': 'MAO-Hybrid-Research/0.1 (+read-only public source client)' } });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location || redirects === 3) return { ok: false, failure: { code: 'redirect_not_allowed', message: 'Source redirect could not be safely followed.' } };
        try { current = new URL(location, current); } catch { return { ok: false, failure: { code: 'redirect_not_allowed', message: 'Source returned an invalid redirect.' } }; }
        continue;
      }
      if (response.status === 401 || response.status === 403) return { ok: false, failure: { code: 'source_access_denied', message: `Source denied public access (HTTP ${response.status}); no authentication was attempted.` } };
      if (response.status === 429) return { ok: false, failure: { code: 'source_rate_limited', message: 'Source rate-limited this request; retry later according to the source terms.' } };
      if (!response.ok) return { ok: false, failure: { code: 'source_unavailable', message: `Source returned HTTP ${response.status}.` } };
      const declaredLength = Number(response.headers.get('content-length'));
      if (Number.isFinite(declaredLength) && declaredLength > maxBytes) return { ok: false, failure: { code: 'source_too_large', message: `Source exceeds the ${maxBytes}-byte limit.` } };
      const bytes = await readBoundedBody(response, maxBytes);
      const contentType = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
      const text = contentType.startsWith('text/') || contentType.includes('html') ? new TextDecoder().decode(bytes) : undefined;
      return { ok: true, document: { url: current.toString(), contentType, bytes, ...(text !== undefined ? { text } : {}) } };
    }
    return { ok: false, failure: { code: 'redirect_not_allowed', message: 'Too many source redirects.' } };
  } catch (error) {
    if (controller.signal.aborted) return { ok: false, failure: { code: 'request_timeout', message: 'Public source request timed out.' } };
    const code = error instanceof ResearchFetchError ? error.code : 'network_unavailable';
    return { ok: false, failure: { code, message: error instanceof Error ? error.message.slice(0, 300) : 'Public source request failed.' } };
  } finally { clearTimeout(timeout); }
}

class ResearchFetchError extends Error {
  constructor(readonly code: FetchFailureCode, message: string) { super(message); }
}

async function readBoundedBody(response: Response, maxBytes: number): Promise<Uint8Array> {
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maxBytes) throw new ResearchFetchError('source_too_large', `Source exceeds the ${maxBytes}-byte limit.`);
    return bytes;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new ResearchFetchError('source_too_large', `Source exceeds the ${maxBytes}-byte limit.`);
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

interface ParsedProduct {
  readonly name: string | null; readonly nameExtraction?: string; readonly nameEvidence?: string;
  readonly manufacturer: string | null; readonly manufacturerExtraction?: string; readonly manufacturerEvidence?: string;
  readonly partNumber: string | null; readonly partNumberExtraction?: string; readonly partNumberEvidence?: string;
  readonly price: number | null; readonly priceExtraction?: string; readonly priceText?: string;
  readonly currency: string | null;
  readonly currencyExtraction?: string;
  readonly availability: string | null; readonly availabilityExtraction?: string; readonly availabilityEvidence?: string;
  readonly datasheetUrl: string | null; readonly datasheetEvidence?: string;
}

function parseProductPage(html: string, pageUrl: string): ParsedProduct {
  const meta = readMetaTags(html);
  const product = findProductJsonLd(html);
  const offers = Array.isArray(product?.offers) ? product.offers.find(isRecord) : isRecord(product?.offers) ? product.offers : undefined;
  const brand = product?.brand;
  const manufacturer = product?.manufacturer;
  const name = firstSourceScalar(
    { value: product?.name, extraction: 'schema.org-product.name' }, { value: meta.get('og:title'), extraction: 'meta:og:title' },
    { value: meta.get('twitter:title'), extraction: 'meta:twitter:title' }, { value: readTitle(html), extraction: 'html:title' },
  );
  const maker = firstSourceScalar(
    { value: isRecord(manufacturer) ? manufacturer.name : manufacturer, extraction: 'schema.org-product.manufacturer' },
    { value: isRecord(brand) ? brand.name : brand, extraction: 'schema.org-product.brand' },
    { value: meta.get('manufacturer'), extraction: 'meta:manufacturer' }, { value: meta.get('brand'), extraction: 'meta:brand' },
  );
  const mpn = firstSourceScalar(
    { value: product?.mpn, extraction: 'schema.org-product.mpn' }, { value: product?.sku, extraction: 'schema.org-product.sku' },
    { value: meta.get('mpn'), extraction: 'meta:mpn' }, { value: meta.get('product:retailer_item_id'), extraction: 'meta:product:retailer_item_id' },
  );
  const pricePick = firstSourceScalar(
    { value: offers?.price, extraction: 'schema.org-offer.price' }, { value: meta.get('product:price:amount'), extraction: 'meta:product:price:amount' },
    { value: meta.get('og:price:amount'), extraction: 'meta:og:price:amount' },
  );
  const currencyPick = firstSourceScalar(
    { value: offers?.priceCurrency, extraction: 'schema.org-offer.priceCurrency' }, { value: meta.get('product:price:currency'), extraction: 'meta:product:price:currency' },
    { value: meta.get('og:price:currency'), extraction: 'meta:og:price:currency' },
  );
  const priceRaw = pricePick?.value;
  const priceCurrency = currencyPick?.value.toUpperCase() ?? null;
  const price = priceRaw && priceCurrency && /^[A-Z]{3}$/.test(priceCurrency) ? parseNonNegativePrice(priceRaw) : null;
  const availabilityPick = firstSourceScalar(
    { value: offers?.availability, extraction: 'schema.org-offer.availability' }, { value: meta.get('product:availability'), extraction: 'meta:product:availability' },
    { value: meta.get('availability'), extraction: 'meta:availability' },
  );
  const availabilityRaw = availabilityPick?.value;
  const availability = availabilityRaw ? availabilityRaw.split(/[\/#]/).filter(Boolean).at(-1) ?? availabilityRaw : null;
  const datasheet = findDatasheetLink(html, pageUrl);
  return {
    name: name?.value ?? null, ...(name ? { nameExtraction: name.extraction, nameEvidence: `Product name: ${name.value}` } : {}),
    manufacturer: maker?.value ?? null, ...(maker ? { manufacturerExtraction: maker.extraction, manufacturerEvidence: `Manufacturer/brand: ${maker.value}` } : {}),
    partNumber: mpn?.value ?? null, ...(mpn ? { partNumberExtraction: mpn.extraction, partNumberEvidence: `MPN/SKU: ${mpn.value}` } : {}),
    price, ...(priceRaw && price !== null && pricePick ? { priceExtraction: pricePick.extraction, priceText: priceRaw } : {}), currency: price !== null ? priceCurrency : null,
    ...(price !== null && currencyPick ? { currencyExtraction: currencyPick.extraction } : {}),
    availability,
    ...(availabilityRaw && availabilityPick ? { availabilityExtraction: availabilityPick.extraction, availabilityEvidence: `Availability: ${availabilityRaw}` } : {}),
    datasheetUrl: datasheet?.url ?? null, ...(datasheet ? { datasheetEvidence: datasheet.evidence } : {}),
  };
}

function readMetaTags(html: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const match of html.matchAll(/<meta\b([^>]*)>/gi)) {
    const attrs = parseAttributes(match[1]);
    const key = String(attrs.property ?? attrs.name ?? '').toLowerCase();
    if (key && attrs.content && !result.has(key)) result.set(key, cleanText(attrs.content));
  }
  return result;
}

function findProductJsonLd(html: string): Record<string, unknown> | undefined {
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    if (!/application\/ld\+json/i.test(match[1])) continue;
    try {
      const decoded: unknown = JSON.parse(match[2]);
      const queue = Array.isArray(decoded) ? [...decoded] : [decoded];
      while (queue.length) {
        const item = queue.shift();
        if (Array.isArray(item)) { queue.push(...item); continue; }
        if (!isRecord(item)) continue;
        if (Array.isArray(item['@graph'])) queue.push(...item['@graph']);
        const types = Array.isArray(item['@type']) ? item['@type'] : [item['@type']];
        if (types.some(type => typeof type === 'string' && /^(Product|ProductGroup)$/i.test(type))) return item;
      }
    } catch { /* Ignore malformed non-authoritative JSON-LD and keep checking public fields. */ }
  }
  return undefined;
}

function findDatasheetLink(html: string, pageUrl: string): { url: string; evidence: string } | undefined {
  for (const match of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi)) {
    const attrs = parseAttributes(match[1]);
    const href = typeof attrs.href === 'string' ? decodeHtml(attrs.href) : '';
    const label = cleanText(match[2]);
    if (!href || !(/\.pdf(?:[?#]|$)/i.test(href) || /datasheet|data\s*sheet|specification/i.test(`${label} ${href}`))) continue;
    try {
      const url = new URL(href, pageUrl);
      if (url.protocol === 'https:' && isAllowedHost(url.hostname, MANUFACTURER_HOSTS)) return { url: url.toString(), evidence: `${label || 'datasheet link'} → ${url}` };
    } catch { /* Invalid link is not reported as a datasheet source. */ }
  }
  return undefined;
}

const PARAMETER_MATCHERS: Readonly<Record<string, RegExp>> = Object.freeze({
  supplyVoltage: /(?:supply voltage|operating voltage|input voltage|VDD|VIN)[^\n]{0,120}?(-?\d+(?:\.\d+)?\s*(?:mV|V)(?:\s*(?:to|–|—|-)\s*-?\d+(?:\.\d+)?\s*(?:mV|V))?)/i,
  supplyCurrent: /(?:supply current|operating current|current consumption|IDD|IQ)[^\n]{0,120}?((?:\d+(?:\.\d+)?|<\s*\d+(?:\.\d+)?)\s*(?:µA|μA|uA|mA|A))/i,
  operatingTemperature: /(?:operating temperature|temperature range)[^\n]{0,120}?(-?\d+(?:\.\d+)?\s*°?\s*C\s*(?:to|–|—|-)\s*[+-]?\d+(?:\.\d+)?\s*°?\s*C)/i,
  interface: /(?:interface|peripheral|communication|serial)[^\n]{0,120}?((?:(?:I2C|I²C|SPI|UART|USB|CAN|PWM|I2S|Ethernet)(?:\s*[,/+]\s*)?){1,8})/i,
  gpioCount: /(?:up to\s+)?(\d{1,3})\s+(?:programmable\s+)?GPIOs?\b/i,
  package: /(?:package|package type)[^\n]{0,100}?\b((?:QFN|SOIC|SOP|TSSOP|LGA|BGA|DIP|WROOM|WROVER)[-\s]?[A-Z0-9-]{1,16})\b/i,
  sensorRange: /(?:measurement range|measuring range|sensing range)[^\n]{0,100}?(-?\d+(?:\.\d+)?\s*(?:to|–|—|-)\s*[+-]?\d+(?:\.\d+)?\s*(?:°C|C|kPa|Pa|bar|m|mm|%RH|g|mg|lux|ppm))/i,
  accuracy: /(?:accuracy|measurement accuracy)[^\n]{0,100}?((?:±|\+\/-)?\s*\d+(?:\.\d+)?\s*(?:%|°C|ppm|LSB))/i,
});

function findParameter(parameter: string, pages: readonly string[]): { value: string; evidence: string; page: number } | undefined {
  const pattern = PARAMETER_MATCHERS[parameter];
  if (!pattern) return undefined;
  for (let index = 0; index < pages.length; index++) {
    const pageText = pages[index];
    const match = pattern.exec(pageText);
    if (!match?.[1]) continue;
    const start = Math.max(0, match.index - 90);
    const end = Math.min(pageText.length, match.index + match[0].length + 90);
    return { value: normalizeSpace(match[1]), evidence: normalizeSpace(pageText.slice(start, end)), page: index + 1 };
  }
  return undefined;
}

interface NormalizedComponent {
  readonly id: string;
  readonly status: ResearchStatus;
  readonly name: SourcedValue<string>;
  readonly manufacturer: SourcedValue<string>;
  readonly partNumber: SourcedValue<string>;
  readonly url: SourcedValue<string>;
  readonly currency: SourcedValue<string>;
  readonly price: SourcedValue<number>;
  readonly availability: SourcedValue<string>;
  readonly datasheetUrl: SourcedValue<string>;
  readonly specifications: Readonly<Record<string, SourcedValue<string | number | boolean>>>;
}

function parseComponents(input: unknown, trust: <T>(raw: unknown, expected: (value: unknown) => value is T, expectedExtractions?: readonly string[]) => SourcedValue<T>, now: () => Date): NormalizedComponent[] {
  if (!Array.isArray(input) || input.length < 2 || input.length > 12) throw new TypeError('components must contain 2–12 candidate objects');
  return input.map((raw, index) => {
    if (!isRecord(raw)) throw new TypeError(`components[${index}] must be an object`);
    const fields = Object.fromEntries(SOURCE_VALUE_FIELDS.map(field => {
      const validField = (value: unknown): value is string | number => field === 'price'
        ? typeof value === 'number' && Number.isFinite(value) && value >= 0
        : typeof value === 'string' && value.length <= 4096;
      return [field, trust(raw[field], validField, COMPONENT_SOURCE_EXTRACTIONS[field])];
    })) as Record<(typeof SOURCE_VALUE_FIELDS)[number], SourcedValue<string | number>>;
    const specsInput = isRecord(raw.specifications) ? raw.specifications : {};
    const specifications = Object.fromEntries(Object.entries(specsInput).slice(0, 64).map(([key, value]) => [key.slice(0, 80), trust(value, isSpecValue, [`datasheet-parameter:${key}`])]));
    const statuses = [...Object.values(fields), ...Object.values(specifications)].map(value => value.status);
    const status: ResearchStatus = statuses.includes('OUTDATED') ? 'OUTDATED' : statuses.length && statuses.every(value => value === 'VERIFIED') ? 'VERIFIED' : statuses.includes('NEEDS_DATASHEET') ? 'NEEDS_DATASHEET' : 'UNVERIFIED';
    return {
      id: typeof raw.id === 'string' && raw.id.length <= 160 ? raw.id : `component-${index + 1}`, status,
      name: fields.name as SourcedValue<string>, manufacturer: fields.manufacturer as SourcedValue<string>, partNumber: fields.partNumber as SourcedValue<string>,
      url: fields.url as SourcedValue<string>, currency: fields.currency as SourcedValue<string>, price: fields.price as SourcedValue<number>,
      availability: fields.availability as SourcedValue<string>, datasheetUrl: fields.datasheetUrl as SourcedValue<string>, specifications,
    };
  });
}

function compareSpecifications(components: readonly NormalizedComponent[]) {
  const keys = [...new Set(components.flatMap(component => Object.keys(component.specifications)))].sort();
  return keys.map(parameter => {
    const values = components.map(component => component.specifications[parameter] ?? { value: null, status: 'NEEDS_DATASHEET' as const, reason: 'No value supplied.' });
    const allVerified = values.every(value => value.status === 'VERIFIED' && value.value !== null);
    const unique = new Set(values.map(value => stableJson(value.value)));
    return { parameter, values: components.map((component, index) => ({ componentId: component.id, ...values[index] })), comparison: !allVerified ? 'UNKNOWN' as const : unique.size === 1 ? 'MATCH' as const : 'DIFFERENT' as const };
  });
}

function compareOffers(components: readonly NormalizedComponent[]) {
  const offers = components.map(component => ({
    componentId: component.id, unitPrice: component.price.value, currency: component.currency.value,
    status: component.price.status === 'VERIFIED' && component.currency.status === 'VERIFIED' ? 'VERIFIED' as const : component.price.status === 'OUTDATED' || component.currency.status === 'OUTDATED' ? 'OUTDATED' as const : 'UNKNOWN' as const,
    provenance: component.price.provenance,
  }));
  const groups = new Map<string, Array<{ componentId: string; unitPrice: number }>>();
  for (const offer of offers) {
    if (offer.status !== 'VERIFIED' || offer.unitPrice === null || !offer.currency) continue;
    const group = groups.get(offer.currency) ?? [];
    group.push({ componentId: offer.componentId, unitPrice: offer.unitPrice });
    groups.set(offer.currency, group);
  }
  return { offers, comparableGroups: [...groups].map(([currency, values]) => ({ currency, offers: values.sort((a, b) => a.unitPrice - b.unitPrice) })) };
}

interface BomLine {
  readonly reference: string; readonly quantity: number; readonly componentId: string;
  readonly status: ResearchStatus;
  readonly name: string | null; readonly manufacturer: string | null; readonly partNumber: string | null; readonly url: string | null;
  readonly currency: string | null; readonly unitPrice: number | null; readonly priceStatus: ResearchStatus; readonly currencyStatus: ResearchStatus;
  readonly availability: string | null; readonly availabilityStatus: ResearchStatus;
  readonly fieldEvidence: Readonly<{ name: SourcedValue<string>; manufacturer: SourcedValue<string>; partNumber: SourcedValue<string>; url: SourcedValue<string>; currency: SourcedValue<string>; price: SourcedValue<number>; availability: SourcedValue<string> }>;
  readonly sourceUrls: readonly string[];
}

function parseBomItems(input: unknown, trust: <T>(raw: unknown, expected: (value: unknown) => value is T, expectedExtractions?: readonly string[]) => SourcedValue<T>): BomLine[] {
  if (!Array.isArray(input) || input.length < 1 || input.length > 200) throw new TypeError('items must contain 1–200 BOM rows');
  return input.map((raw, index) => {
    if (!isRecord(raw) || !isRecord(raw.component)) throw new TypeError(`items[${index}] must include a component object`);
    const reference = boundedText(raw.reference, 1, 80, `items[${index}].reference`);
    const quantity = typeof raw.quantity === 'number' && Number.isFinite(raw.quantity) && raw.quantity > 0 && raw.quantity <= 1_000_000 ? raw.quantity : NaN;
    if (!Number.isFinite(quantity)) throw new TypeError(`items[${index}].quantity must be a positive finite number`);
    const component = raw.component;
    const name = trust(component.name, isString, COMPONENT_SOURCE_EXTRACTIONS.name);
    const manufacturer = trust(component.manufacturer, isString, COMPONENT_SOURCE_EXTRACTIONS.manufacturer);
    const partNumber = trust(component.partNumber, isString, COMPONENT_SOURCE_EXTRACTIONS.partNumber);
    const url = trust(component.url, isString, COMPONENT_SOURCE_EXTRACTIONS.url);
    const isCurrency = (value: unknown): value is string => isString(value) && /^[A-Z]{3}$/.test(value);
    const isPrice = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
    const currency = trust(component.currency, isCurrency, COMPONENT_SOURCE_EXTRACTIONS.currency);
    const price = trust(component.price, isPrice, COMPONENT_SOURCE_EXTRACTIONS.price);
    const availability = trust(component.availability, isString, COMPONENT_SOURCE_EXTRACTIONS.availability);
    const requiredStatuses = [name.status, manufacturer.status, partNumber.status, url.status, currency.status, price.status];
    const statuses = [...requiredStatuses, availability.status];
    const status: ResearchStatus = statuses.includes('OUTDATED') ? 'OUTDATED' : requiredStatuses.every(value => value === 'VERIFIED') ? 'VERIFIED' : statuses.includes('NEEDS_DATASHEET') ? 'NEEDS_DATASHEET' : 'UNVERIFIED';
    const sourceUrls = [...new Set([name, manufacturer, partNumber, url, currency, price, availability].flatMap(value => value.provenance?.sourceUrl ? [value.provenance.sourceUrl] : []))];
    return {
      reference, quantity, componentId: typeof component.id === 'string' ? component.id : `component-${index + 1}`, status,
      name: name.value, manufacturer: manufacturer.value, partNumber: partNumber.value, url: url.value,
      currency: currency.value, unitPrice: price.value, priceStatus: price.status, currencyStatus: currency.status,
      availability: availability.value, availabilityStatus: availability.status,
      fieldEvidence: { name: name as SourcedValue<string>, manufacturer: manufacturer as SourcedValue<string>, partNumber: partNumber as SourcedValue<string>, url: url as SourcedValue<string>, currency, price, availability },
      sourceUrls,
    };
  });
}

function validateSourceUrl(rawUrl: string, hosts: readonly string[]): { ok: true; url: URL } | { ok: false; message: string } {
  let url: URL;
  try { url = new URL(rawUrl); } catch { return { ok: false, message: 'Source must be an absolute HTTPS URL.' }; }
  if (!isAllowedHost(url.hostname, hosts)) return { ok: false, message: `Source host is not in the approved public-source list: ${url.hostname}` };
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return { ok: false, message: 'Only HTTPS URLs without credentials or custom ports are allowed.' };
  if (url.hash.length > 512) return { ok: false, message: 'Source URL fragment is too long.' };
  return { ok: true, url };
}

function isAllowedHost(host: string, hosts: readonly string[]): boolean {
  const normalized = host.toLowerCase().replace(/\.$/, '');
  return hosts.some(approved => normalized === approved || normalized.endsWith(`.${approved}`));
}
function classifySourceUrlFailure(url: URL, hosts: readonly string[]): FetchFailureCode {
  if (!isAllowedHost(url.hostname, hosts)) return 'source_not_allowlisted';
  return 'invalid_source_url';
}
function isManufacturerHost(host: string): boolean { return isAllowedHost(host, MANUFACTURER_HOSTS); }
function hostLabel(rawUrl: string): string { try { return new URL(rawUrl).hostname; } catch { return 'unknown source'; } }
function validSearchResultUrl(rawUrl: string): boolean { try { const url = new URL(rawUrl); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password; } catch { return false; } }
function decodeSearchUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl, 'https://html.duckduckgo.com');
    if ((url.hostname === 'duckduckgo.com' || url.hostname === 'html.duckduckgo.com') && url.pathname === '/l/') {
      const target = url.searchParams.get('uddg');
      if (target) return target;
    }
    return url.toString();
  } catch { return rawUrl; }
}
function hasChallenge(text: string): boolean { return /captcha|verify you are human|unusual traffic|automated quer(?:y|ies)|access denied|enable javascript to continue/i.test(text.slice(0, 200_000)); }
function isHtmlContentType(contentType: string): boolean { return contentType.includes('text/html') || contentType.includes('application/xhtml+xml'); }
function isPdfContentType(contentType: string): boolean { return contentType === 'application/pdf' || contentType === 'application/x-pdf'; }

function decodeHtml(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|quot|apos|#39|lt|gt|nbsp);/gi, (_, entity: string) => {
    if (entity.startsWith('#x')) return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
    if (entity.startsWith('#')) return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
    return ({ amp: '&', quot: '"', apos: "'", '#39': "'", lt: '<', gt: '>', nbsp: ' ' } as Record<string, string>)[entity.toLowerCase()] ?? '';
  });
}
function cleanText(value: string): string { return normalizeSpace(decodeHtml(value.replace(/<[^>]*>/g, ' '))); }
function htmlToText(value: string): string { return normalizeSpace(decodeHtml(value.replace(/<script\b[\s\S]*?<\/script\s*>/gi, ' ').replace(/<style\b[\s\S]*?<\/style\s*>/gi, ' ').replace(/<[^>]*>/g, '\n'))); }
function normalizeSpace(value: string): string { return value.replace(/\u00a0/g, ' ').replace(/[\t\r ]+/g, ' ').replace(/\n\s*\n/g, '\n').trim(); }
function parseAttributes(raw: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const match of raw.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) result[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? '';
  return result;
}
function readTitle(html: string): string | undefined { const match = html.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i); return match ? cleanText(match[1]) : undefined; }
function firstSourceScalar(...values: readonly { readonly value: unknown; readonly extraction: string }[]): { readonly value: string; readonly extraction: string } | undefined {
  for (const candidate of values) {
    if (typeof candidate.value === 'string' && candidate.value.trim()) return { value: candidate.value.trim(), extraction: candidate.extraction };
    if (typeof candidate.value === 'number' && Number.isFinite(candidate.value)) return { value: String(candidate.value), extraction: candidate.extraction };
  }
  return undefined;
}
function parseNonNegativePrice(value: string): number | null { const normalized = value.trim(); if (!/^\d+(?:\.\d{1,6})?$/.test(normalized)) return null; const number = Number(normalized); return Number.isFinite(number) && number >= 0 ? number : null; }
function normalizeRequirements(input: unknown): Record<string, string | number | boolean> {
  if (input === undefined) return {};
  if (!isRecord(input) || Object.keys(input).length > 24) throw new TypeError('requirements must be an object with at most 24 entries');
  const output: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(input)) {
    if (!/^[A-Za-z][A-Za-z0-9 _.-]{0,60}$/.test(key) || !(typeof value === 'string' && value.length <= 120 || typeof value === 'number' && Number.isFinite(value) || typeof value === 'boolean')) throw new TypeError(`Invalid requirement ${key}`);
    output[key] = value;
  }
  return output;
}
function parseBudget(maxUnitPrice: unknown, currency: unknown): { readonly maxUnitPrice: number | null; readonly currency: string | null } {
  if (maxUnitPrice !== undefined && (typeof maxUnitPrice !== 'number' || !Number.isFinite(maxUnitPrice) || maxUnitPrice < 0)) throw new TypeError('maxUnitPrice must be a non-negative finite number');
  if (currency !== undefined && (typeof currency !== 'string' || !/^[A-Z]{3}$/.test(currency))) throw new TypeError('currency must be a three-letter uppercase code');
  return { maxUnitPrice: typeof maxUnitPrice === 'number' ? maxUnitPrice : null, currency: typeof currency === 'string' ? currency : null };
}
function assessBudget(price: number | null, currency: string | null, budget: { maxUnitPrice: number | null; currency: string | null }): ResearchComponent['budgetAssessment'] {
  if (price === null || currency === null || budget.maxUnitPrice === null || !budget.currency || currency !== budget.currency) return 'UNKNOWN';
  return price <= budget.maxUnitPrice ? 'WITHIN_BUDGET' : 'OVER_BUDGET';
}
function parseParameterList(value: unknown): string[] {
  if (value === undefined) return [...DEFAULT_EXTRACTION_PARAMETERS];
  if (!Array.isArray(value) || value.length < 1 || value.length > 16 || value.some(parameter => typeof parameter !== 'string' || !(parameter in PARAMETER_MATCHERS))) throw new TypeError(`parameters must be selected from ${Object.keys(PARAMETER_MATCHERS).join(', ')}`);
  return [...new Set(value as string[])];
}
function stableComponentId(url: string): string { return `component-${Buffer.from(url).toString('base64url').slice(0, 24)}`; }
function isSpecValue(value: unknown): value is string | number | boolean { return typeof value === 'string' && value.length <= 512 || typeof value === 'number' && Number.isFinite(value) || typeof value === 'boolean'; }
function safeProvenance(value: Record<string, unknown>): ResearchProvenance | undefined {
  if (!isResearchSourceType(value.sourceType) || typeof value.sourceUrl !== 'string' || typeof value.sourceName !== 'string' || typeof value.checkedAt !== 'string' || typeof value.extraction !== 'string' || typeof value.evidence !== 'string') return undefined;
  return { sourceType: value.sourceType, sourceUrl: value.sourceUrl, sourceName: value.sourceName, checkedAt: value.checkedAt, extraction: value.extraction, evidence: value.evidence.slice(0, 600), ...(typeof value.page === 'number' ? { page: value.page } : {}), ...(typeof value.evidenceId === 'string' ? { evidenceId: value.evidenceId } : {}) };
}
function isResearchSourceType(value: unknown): value is ResearchSourceType { return value === 'search-result' || value === 'manufacturer-page' || value === 'distributor-page' || value === 'datasheet'; }
function isResearchCapability(value: string): value is ResearchCapability { return value === 'research' || value === 'technical-research' || value === 'component-sourcing' || value === 'datasheet-analysis' || value === 'bom'; }
function isString(value: unknown): value is string { return typeof value === 'string' && value.length <= 4096; }
function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value && typeof value === 'object' && !Array.isArray(value)); }
function asRecord(value: unknown): Record<string, unknown> { if (!isRecord(value)) throw new TypeError('Tool arguments must be a JSON object'); return value; }
function boundedText(value: unknown, min: number, max: number, name: string): string { if (typeof value !== 'string' || value.trim().length < min || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) throw new TypeError(`${name} must be ${min}–${max} characters of plain text`); return value.trim(); }
function boundedInteger(value: unknown, min: number, max: number, name: string): number { if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) throw new TypeError(`${name} must be an integer between ${min} and ${max}`); return value; }
function ok<T>(toolId: string, data: T, now: () => Date): ResearchToolResult<T> { return { toolId, status: 'VERIFIED', checkedAt: now().toISOString(), data }; }
function blocked(toolId: string, failure: FetchFailure, now: () => Date): ResearchToolResult { return { toolId, status: 'BLOCKED', checkedAt: now().toISOString(), reasonCode: failure.code, message: failure.message, data: { results: [], candidates: [], parameters: {} } }; }
function stableJson(value: unknown): string { try { return JSON.stringify(value) ?? 'undefined'; } catch { return String(value); } }
function roundMoney(value: number): number { return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000; }

async function extractPdfText(pdf: Uint8Array, options: { readonly timeoutMs: number; readonly maxOutputBytes: number }): Promise<string> {
  const { spawn } = await import('node:child_process');
  return new Promise((resolve, reject) => {
    const child = spawn('pdftotext', ['-layout', '-', '-'], { shell: false, stdio: ['pipe', 'pipe', 'pipe'], env: { PATH: process.env.PATH ?? '/usr/bin:/bin', LANG: 'C.UTF-8' } });
    let stdout = Buffer.alloc(0); let stderr = ''; let settled = false;
    const finish = (error?: Error, value?: string) => { if (settled) return; settled = true; clearTimeout(timer); if (error) reject(error); else resolve(value ?? ''); };
    const timer = setTimeout(() => { child.kill('SIGKILL'); finish(new Error('pdftotext timed out')); }, options.timeoutMs);
    child.stdout.on('data', (chunk: Buffer) => {
      stdout = Buffer.concat([stdout, chunk]);
      if (stdout.length > options.maxOutputBytes) { child.kill('SIGKILL'); finish(new Error('pdftotext output exceeded the configured limit')); }
    });
    child.stderr.on('data', (chunk: Buffer) => { stderr = (stderr + chunk.toString('utf8')).slice(-4000); });
    child.once('error', (error: NodeJS.ErrnoException) => finish(new Error(error.code === 'ENOENT' ? 'pdftotext is not installed' : error.message)));
    child.once('close', code => code === 0 ? finish(undefined, stdout.toString('utf8')) : finish(new Error(stderr.trim() || `pdftotext exited with ${code}`)));
    child.stdin.end(Buffer.from(pdf));
  });
}
