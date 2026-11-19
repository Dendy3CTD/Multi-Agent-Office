# Task Store

Synchronous SQLite task/project persistence for the MAO Hybrid company package. It stores task plans, ordered steps, bounded attempts, execution IDs, idempotency keys, project workspace roots, results, and task events. The store accepts at most two active steps and never reclaims a persisted `running` step by itself; `Company.resume()` must inspect its existing execution ID through the RuntimePort first.

Use Node.js 22.5 or newer (`node:sqlite`). Run tests with `npm test` from this package directory or `node --test test/*.test.js`.
