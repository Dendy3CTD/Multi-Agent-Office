# MAO local server

The server binds to loopback only and uses the Fake Runtime unless production
runtime readiness is explicitly configured. Authentication is bootstrapped into
an owner-only file outside the repository.

## Debian startup

From the repository root:

```bash
corepack pnpm --filter @open-agent-office/server build
corepack pnpm --filter @open-agent-office/server start
```

The default address is `http://127.0.0.1:3000`. The first start creates
`~/.config/open-agent-office/token` with owner-only permissions. The token is
never printed by the server. To query health from another local shell:

```bash
TOKEN_FILE="$HOME/.config/open-agent-office/token"
curl -fsS -H "Authorization: Bearer $(<"$TOKEN_FILE")" http://127.0.0.1:3000/v1/health
```

Optional local configuration:

```bash
export MAO_HOST=127.0.0.1
export MAO_PORT=3000
export MAO_TOKEN_FILE="$HOME/.config/open-agent-office/token"
export MAO_RUNTIME_CONFIG="$HOME/.config/open-agent-office/runtime.json"
export MAO_ARCHIVE_ROOT="$HOME/.local/share/open-agent-office/vault"
export MAO_DELIVERY_JOURNAL="$HOME/.local/share/open-agent-office/vault/.oao-delivery/events.jsonl"
corepack pnpm --filter @open-agent-office/server start
```

`MAO_HOST` accepts only `127.0.0.1`, `localhost` or `::1`. Production
Codex/OpenCode runtimes remain blocked unless their readiness facts are
explicitly verified. A runtime config file does not contain credentials.

## Operations

```bash
# status and readiness
curl -fsS -H "Authorization: Bearer $(<"$HOME/.config/open-agent-office/token")" http://127.0.0.1:3000/v1/status
curl -fsS -H "Authorization: Bearer $(<"$HOME/.config/open-agent-office/token")" http://127.0.0.1:3000/v1/runtimes

# stop gracefully
kill -TERM <server-pid>
```

`SIGINT` and `SIGTERM` stop the HTTP listener and wait for the journal/archive
close path. Socket smoke tests may be skipped with `EPERM` in a restricted
sandbox; this does not imply that loopback binding is unavailable on Debian.

The server does not start real LLM execution during startup.
