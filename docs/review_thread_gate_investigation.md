# Review Thread Gate Investigation (`oh-tab-89p8`)

## Summary

PR #969 exposed a timing gap where `unresolved-review-threads` could remain green after new AI review threads were created. This was not a GraphQL/query logic bug in the gate job. It was an event trigger coverage issue.

## Evidence Timeline (PR #969)

All times UTC on 2026-02-07.

| Time | Event |
| --- | --- |
| 16:59:20 | `Review Thread Gate` run `21783582163` starts on head `0770a10` |
| 16:59:29 | Same run completes `success` |
| 17:01:10 | `Review Thread Gate` run `21783612499` starts on head `0770a10` |
| 17:01:17 | Same run completes `success` |
| 17:02:23 | Gemini inline review thread created (`discussion_r2777787350`) |
| 17:04:13 | CodeRabbit inline review thread created (`discussion_r2777791648`) |
| 17:04:14 | Additional CodeRabbit inline review threads created (`discussion_r2777791655`, `discussion_r2777791658`) |
| 17:06:59 | Reviewer message (`PinkStone`, Agent Mail `#5137`) confirms unresolved threads are present and blocks merge |
| 17:09:54 | `Review Thread Gate` run `21783740976` starts on new head `9dafd30` and fails (unresolved threads detected) |
| 17:11:31 | `Review Thread Gate` run `21783765526` starts on head `83bf9fa` and later passes after thread resolution |

## Root Cause

The workflow originally triggered only on `pull_request` activity (`opened`, `synchronize`, `reopened`, `ready_for_review`, `edited`). AI review threads could be created after the most recent `pull_request`-triggered run, with no immediate rerun of the gate.

## Fix

Extended `.github/workflows/review-thread-gate.yml` triggers to include review activity:

- `pull_request_review` (`submitted`, `edited`, `dismissed`)
- `pull_request_review_comment` (`created`, `edited`, `deleted`)
- `workflow_dispatch` with `pr_number` input as a manual rerun fallback when only thread resolution state changes

GitHub exposes `pull_request_review_thread` as a webhook event, but not as a supported Actions workflow trigger. Because of that, this guardrail relies on supported review/comment triggers plus manual dispatch for thread-state-only transitions.

The job now resolves PR metadata directly and skips non-`develop` base branches in-script, so `pull_request` and manual dispatch paths use the same logic.

```yaml
on:
  pull_request:
    branches: [develop]
    types: [opened, synchronize, reopened, ready_for_review, edited]
  pull_request_review:
    types: [submitted, edited, dismissed]
  pull_request_review_comment:
    types: [created, edited, deleted]
  workflow_dispatch:
    inputs:
      pr_number:
        required: true
        type: number

jobs:
  unresolved-review-threads:
    # Base branch guard is evaluated in-script after loading PR metadata.
```

## Operational Guidance

- Keep `unresolved-review-threads` as a required status check.
- Continue the manual final pass in GitHub "Files changed" before merge, since review-thread resolution is still a human process step even with improved event coverage.
- If only thread resolution changed and no supported trigger fired, rerun via `workflow_dispatch` with the PR number.
