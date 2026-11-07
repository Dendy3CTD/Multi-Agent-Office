# Model Manager

`@open-agent-office/model-manager` implements C07 Model Gateway. It loads a
validated immutable model catalog and returns deterministic `ModelSelection`
values from read-only Runtime, budget, profession and statistics snapshots.

The package never executes a Runtime, reserves budget slots, calls a provider,
or infers real Codex models from `FakeCodexBackend`. The shipped catalog only
contains the four confirmed OpenCode Go assignments from `OAO-MODEL-002`.
