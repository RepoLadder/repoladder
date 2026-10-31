# Changelog

## 0.4.0

### Minor Changes

- 1efddcb: Add `analyzeFiles`, an analyze-only library entry that returns the extracted facts without grouping, layout or HTML, for callers that only need structure. `buildFromFiles` is unchanged.

## 0.3.0

### Minor Changes

- 1eed5b8: Add an opt-in hosted fidelity profile (`--profile hosted`, or the `profile` option of `buildFromFiles`) that budgets the file board's arrows again so big repos build within a hosted time limit. The default profile stays `full` and its output is unchanged.

## 0.2.0

First release published from the public repo.
