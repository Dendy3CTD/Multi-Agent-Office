import { createResearchTools, createTaskResearchDispatcher, type ResearchComponent, type ResearchStatus } from '@mao-hybrid/tools-research';
import type { ResearchMcpLaunchOptions } from '@mao-hybrid/tools-research/mcp-server';

const currentStatus: ResearchStatus = 'NEEDS_DATASHEET';
const component: ResearchComponent | undefined = undefined;
const launch: ResearchMcpLaunchOptions = {
  projectId: 'consumer-project', taskId: 'consumer-task', executionId: 'consumer-execution', workspaceRoot: process.cwd(),
  employee: { professionId: 'electrical-engineer', skills: [] }, employeeCapabilities: ['research'], allowedToolIds: ['research.capabilities'],
};
const dispatcher = createTaskResearchDispatcher({ ...launch, employee: launch.employee });
void [currentStatus, component, dispatcher.summaries];
