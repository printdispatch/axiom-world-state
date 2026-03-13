# Contributing to Axiom World State

Thank you for your interest in contributing. This document outlines the standards and process for contributing to this project.

## Core Principle

Before writing a single line of code, read [`axiom_philosophy.md`](./axiom_philosophy.md). Every contribution must be consistent with the five principles defined there. A pull request that violates those principles will not be merged, regardless of technical quality.

## Development Philosophy

This system prioritizes **correctness over speed** and **traceability over convenience**. When in doubt, surface ambiguity rather than resolve it silently. The review queue exists for a reason.

## Getting Started

1. Fork the repository and clone your fork.
2. Install dependencies: `pnpm install`
3. Run the type checker to confirm your environment is healthy: `pnpm check`
4. Create a feature branch from `main`: `git checkout -b feature/your-feature-name`

## Build Order

All contributions must follow the phase sequence defined in [`BUILD_ORDER.md`](./BUILD_ORDER.md). Do not implement Phase 3 features before Phase 2 acceptance criteria are met. Each phase must pass its defined acceptance tests before the next phase begins.

## Code Standards

- All code is written in **TypeScript** with strict mode enabled.
- Every function that mutates world state must accept and validate a `ProvenanceRef[]` argument.
- No function may skip provenance validation. Use `requireProvenance()` from `src/provenance.ts`.
- Entity creation must always check for existing entities first. Use the normalization rules in `rules/normalization_rules.md`.
- Inference logic must only run after layers 1–4 of the six-layer model are complete.

## Commit Messages

Use the following format:

```
[phase-N] Short description of the change

Longer explanation if needed. Reference the relevant rule or protocol file.
```

Example:
```
[phase-1] Implement signal gateway with provenance enforcement

Adds SignalGateway class that normalizes incoming email and calendar signals
into Signal objects. All signals are persisted with provenance before the
signal_received event is emitted. Follows rules/provenance_rules.md.
```

## Pull Request Process

1. Ensure `pnpm check` passes with zero errors.
2. Ensure all tests in the relevant phase pass.
3. Update `BUILD_ORDER.md` to reflect the new status of the phase (e.g., `In Progress` → `Complete`).
4. Reference the acceptance criteria from `BUILD_ORDER.md` in your pull request description.
5. A maintainer will review your pull request against the acceptance criteria before merging.

## Testing

Every new piece of engine logic must include unit tests in `tests/unit/`. Integration tests in `tests/integration/` should cover the sample ingest cases defined in `docs/sample_ingest_cases.md`.

## Questions

Open a GitHub Discussion if you have questions about architecture or design decisions. Issues are reserved for bugs and feature requests tied to a specific build phase.
