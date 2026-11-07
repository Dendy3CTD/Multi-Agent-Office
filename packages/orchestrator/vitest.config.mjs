// Tests resolve sibling workspace packages from their sources, so no pnpm link is needed.
import { fileURLToPath } from "node:url";

const repo = (relative) => fileURLToPath(new URL(relative, import.meta.url));

const alias = (name) => ({ find: new RegExp(`^@open-agent-office/${name}$`), replacement: repo(`../${name}/src/index.ts`) });

export default {
  resolve: {
    alias: [ alias("shared"),
      { find: /^@open-agent-office\/budget-manager$/, replacement: repo("../budget-manager/src/index.ts") },
      { find: /^@open-agent-office\/runtime-opencode$/, replacement: repo("../runtime-opencode/src/index.ts") },
    ],
  },
};
