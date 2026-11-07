import { fileURLToPath } from "node:url";
const repo = (relative) => fileURLToPath(new URL(relative, import.meta.url));
export default { resolve: { alias: [{ find: /^@open-agent-office\/shared$/, replacement: repo("../shared/src/index.ts") }] } };
