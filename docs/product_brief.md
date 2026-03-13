# Product Brief

## Name
Axiom World State

## Purpose
Axiom World State is a persistent event-and-entity system for LLM agents.

Its job is to:
- ingest external signals
- normalize entities
- update factual state
- track obligations
- generate bounded inferences
- maintain auditable active memory
- provide a human-readable timeline for review

## Primary Human Goal
Give the operator a trustworthy interface for understanding:
- what happened
- what changed
- what the system inferred
- what actions are proposed
- why those actions were proposed

## Primary System Goal
Preserve continuity across sessions without losing provenance, state history, or unresolved obligations.

## Non-Goals
The system is not:
- a generic chatbot shell
- a generic CRM
- a pure automation engine
- a black-box autonomous agent

## Design Principles
1. Raw signals are never destroyed.
2. Factual state is separate from inference.
3. Every world-state mutation must cite provenance.
4. Ambiguity must surface in review, not disappear.
5. High-risk actions require approval.
6. The interface should prioritize inspectability over polish.

## Primary UX Model
The primary interface is a feed-first timeline with drill-down inspection.
The system should feel like an auditable cognitive instrument, not a dashboard toy.

## Core User Questions
The product must help answer:
- What just happened?
- What changed in the world state?
- What is still unresolved?
- What is the system unsure about?
- What action is ready now?
- What needs approval?
