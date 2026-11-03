# Obsidian Archive Specification

## Existing vault

`~/Документы/Obsidian Vault`

## Dedicated project documentation

`02 - 🚀 ПРОЕКТЫ/Open Agent Office/`

## Dedicated runtime archive

`09 - 🗃️ АРХИВ/Open Agent Office/`

## Archive categories

- Projects
- Tasks
- Employees
- Daily Logs
- Events
- Decisions
- Reports
- Artifacts
- Skills

## Durability

Every important event is first committed to SQLite. A transactional
outbox marks events pending export. The exporter writes Markdown using
stable event IDs and atomic file replacement. It marks an event exported
only after the file is safely written.

## Privacy

Never archive credentials, API keys, passwords, cookies or private keys.
Redact sensitive values in command arguments and tool input/output.
Provide configurable exclusions for files and directories.

## Obsidian compatibility

Use standard Markdown, YAML frontmatter and `[[wikilinks]]`.
Do not require paid Obsidian plugins or proprietary database formats.
