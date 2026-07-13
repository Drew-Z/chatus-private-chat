# Fix route model count mismatch

## Goal

Investigate and fix the admin model picker reporting two fetched models while only one selectable model is shown.

## Requirements

- Explain the browser-native `datalist` behavior: the API count is the total unique model count, while the open suggestion list is filtered by the current model input.
- Make the post-fetch status distinguish the total fetched count from the currently filtered suggestion view.
- Preserve the current model value and the existing OpenAI- and Anthropic-compatible model-list response shapes.
- Do not log or persist upstream response bodies, route keys, or other credential material while diagnosing the issue.
- Add a frontend structural regression assertion for the clarified status message.

## Acceptance Criteria

- [ ] A one-model response still reports one fetched model.
- [ ] When multiple models are fetched while the input is non-empty, the UI explains that the browser filters suggestions and that clearing the field reveals all options.
- [ ] The existing model value is not cleared or changed automatically.
- [ ] Frontend structure checks, Worker tests, typecheck, Wrangler dry-run, and diff check pass.

## Notes

- Screenshot evidence shows `claude-opus-4-7` as the only visible option while the status says two models were fetched.
