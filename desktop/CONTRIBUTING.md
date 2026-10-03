# Contributing to Origin Workbench

Read the [project contribution guide](../CONTRIBUTING.md) and [desktop rules](AGENTS.md).

Before committing, run the full unit/integration suite, the normal/adversarial creation workflow checks and the build/type/i18n checks. Run coverage before opening a PR and report the actual result; the coverage target is 80%, while inherited suite thresholds are currently informational. Do not claim the target has been reached unless measured.

Use Conventional Commit titles, for example `fix(studio): preserve edits during save`. PR descriptions should explain the concrete problem, behavior, verification and limits. Do not add AI signatures or co-authorship trailers.

When pushing authorized changes, use `just push` from this directory. The recipe must pass lint, formatting, type checks, i18n and tests before pushing. Keep original open-source notices and document modifications.
