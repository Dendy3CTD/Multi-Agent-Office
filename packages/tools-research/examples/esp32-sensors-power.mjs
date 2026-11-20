import { createTaskResearchDispatcher } from '../dist/index.js';

const workspaceRoot = process.env.MAO_PROJECT_WORKSPACE;
if (!workspaceRoot) throw new Error('Set MAO_PROJECT_WORKSPACE to a registered project workspace.');

const dispatcher = createTaskResearchDispatcher({
  projectId: process.env.MAO_PROJECT_ID ?? 'research-demo-project',
  taskId: process.env.MAO_TASK_ID ?? 'research-demo-task',
  executionId: process.env.MAO_EXECUTION_ID ?? 'research-demo-execution',
  workspaceRoot,
  employee: { id: 'research-demo-engineer', professionId: 'electrical-engineer', skills: [] },
});

const searches = [
  { label: 'ESP32 controller', query: 'Espressif ESP32 development module', requirements: { wireless: 'Wi-Fi and Bluetooth', supplyVoltage: '3.3 V' } },
  { label: 'Sensors', query: 'I2C temperature humidity sensor manufacturer datasheet', requirements: { interface: 'I2C', measurements: 'temperature and humidity' } },
  { label: 'Power supply', query: 'DC DC buck converter module datasheet', requirements: { inputVoltage: '12 V nominal', outputVoltage: '5 V', outputCurrent: 'required load current' } },
];

for (const search of searches) {
  const result = await dispatcher.invoke('research.component.search', {
    query: search.query,
    requirements: search.requirements,
    maxResults: 5,
  });
  process.stdout.write(`${JSON.stringify({ label: search.label, ...result }, null, 2)}\n`);
}
