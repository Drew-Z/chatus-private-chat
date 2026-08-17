# Frontend accessibility test matrix

## Goal

Turn the audit's responsive and accessibility expectations into a maintainable browser regression matrix.

## Requirements

- Cover the intermediate layout widths introduced by the responsive child.
- Exercise both normal and reduced-motion preferences.
- Add an automated accessibility baseline for representative member and admin states.
- Run representative coverage on more than one browser engine where the environment supports it.
- Keep all network activity fixture-backed and prevent model/provider requests.

## Acceptance Criteria

- [ ] Browser tests include 781, 1024, 1280, and 1439px assertions in addition to phone and wide desktop coverage.
- [ ] At least one normal-motion and one reduced-motion project/scenario run.
- [ ] Automated accessibility scans cover authenticated member and admin workspaces with documented intentional exclusions only.
- [ ] A non-Chromium engine runs a representative smoke/accessibility subset, or a documented deterministic capability check skips it.
- [ ] Chat/model endpoints are intercepted and unexpected provider traffic fails the test.
- [ ] CI/local commands remain documented and deterministic.

## Notes

- Baseline evidence: `tests/browser/playwright.config.ts:15` and `tests/browser/workspace-visual.spec.ts:122`.
