# Provider cost reconciliation and capacity design

## Evidence Taxonomy

Usage and cost events keep evidence class and provenance. Normalization adapters
never coerce missing values to zero. Late evidence appends a new event linked to
the attempt and superseded evidence.

## Pricing

An immutable effective-dated catalog records Provider/offering/model dimensions,
unit prices, currency, precision, validity interval, provenance and approval.
Attempts bind the selected version at start. Historical recomputation is a new
projection/correction, not an in-place edit.

## Reconciliation

A bounded import adapter stores fingerprints and normalized summaries, not raw
invoices in ordinary telemetry. It maps evidence to attempts where exact and
retains unmatched variance where not. Status transitions are versioned and
idempotent.

## Projections

Capacity and spend projections are rebuildable from append-only evidence and
separate unknown/provisional/settled/corrected state. UI/API schemas are strict,
content-free and authorization-scoped. Feedback dimensions do not exist.

## Rollback

Disable imports or projections while retaining encrypted source evidence and
append-only ledger history. Fall back to shadow attempt visibility; do not erase
corrections or reinterpret unknown as zero.
