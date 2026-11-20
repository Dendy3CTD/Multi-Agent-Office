import assert from 'node:assert/strict';
import test from 'node:test';
import { RESEARCH_TOOL_IDS, createResearchTools, createTaskResearchDispatcher } from '@mao-hybrid/tools-research';
import { createResearchMcpHandlers } from '@mao-hybrid/tools-research/mcp-server';

test('published package names expose the host factories and MCP adapter', () => {
  assert.equal(typeof createResearchTools, 'function');
  assert.equal(typeof createTaskResearchDispatcher, 'function');
  assert.equal(typeof createResearchMcpHandlers, 'function');
  assert.ok(RESEARCH_TOOL_IDS.includes('research.bom.compile'));
});
