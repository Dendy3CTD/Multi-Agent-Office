import { fileURLToPath } from "node:url";
const repo = (relative) => fileURLToPath(new URL(relative, import.meta.url));
const alias = (name) => ({ find: new RegExp(`^@open-agent-office/${name}$`), replacement: repo(`../../packages/${name}/src/index.ts`) });
export default { resolve: { alias: [alias("shared"), alias("orchestrator"), alias("directory"), alias("model-manager"), alias("budget-manager")] } };
