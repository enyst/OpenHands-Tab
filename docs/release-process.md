# OpenHands-Tab release process

This document is a step-by-step checklist for releasing the OpenHands-Tab VS Code extension. It is documentation only; do not treat it as automation.

## 0) Preconditions (access + context)

1. Confirm you have:
   - Push access to `develop` (via PR merge) and permission to push tags.
   - Permission to create GitHub Releases in the repo.
   - (Optional) VS Code Marketplace publisher access + `vsce` credentials/token.
   - (Optional) Open VSX publishing token.
2. Confirm `develop` is green (unit tests, typecheck, e2e as applicable).
3. Decide the target version `X.Y.Z` (the workflow expects **no `v` prefix**; see Tagging below).

## 1) Pre-release checklist (local)

1. Update your local checkout:
   - `git fetch origin`
   - `git switch develop && git pull`
2. Create a release branch:
   - `git switch -c release/X.Y.Z`
3. Bump the extension version in `package.json` (and `package-lock.json`):
   - Prefer: `npm version X.Y.Z --no-git-tag-version`
   - Alternatively, edit `package.json` manually, then run `npm i --package-lock-only`
   - Note: avoid creating a tag locally here; the tag should be created on the final commit that lands on `develop`.
4. (Recommended) Sanity checks:
   - `npm ci`
   - `npm run build`
   - `npm run typecheck`
   - `npm test`
   - If the release includes runtime or packaging behavior changes: `npm run e2e`
5. (Optional but recommended) Build the VSIX locally:
   - `npm run package`
   - This runs `scripts/run-vsce-package.cjs` (wraps `vsce package` and follows symlinks).

## 2) Release PR workflow (GitHub)

1. Commit the version bump:
   - `git add package.json package-lock.json`
   - `git commit -m "release: X.Y.Z"`
2. Push the release branch:
   - `git push -u origin release/X.Y.Z`
3. Open a PR targeting `develop`.
4. ⏳ Wait for CI:
   - `.github/workflows/build-vsix.yml` runs on PRs to `develop` and will package a `.vsix` artifact.
   - The workflow posts a PR comment with a link to the Actions run where you can download the artifact.
5. Get review/approval per the repo process.
6. Merge the PR into `develop`.
   - Important: the commit that ends up on `develop` after merging (merge commit or squash result) is what you should tag.

## 3) Tagging + GitHub Release (recommended path)

This repo’s `Build VSIX (PRs and develop)` workflow is configured to run the release job only for tags matching:
- `X.Y.Z` (example: `0.6.1`)

It will **not** match `vX.Y.Z` unless the workflow is changed.

1. Update local `develop` to include the merged release PR:
   - `git switch develop && git pull`
2. Create the tag on the `develop` HEAD commit (the merge result):
   - `git tag X.Y.Z`
3. Push the tag:
   - `git push origin X.Y.Z`
4. ⏳ Wait for the tag build to complete (~10–20 minutes depending on CI load).
   - `build-vsix.yml` verifies the tag name equals `package.json` version.
   - It builds/tests, packages the `.vsix`, uploads it as an artifact, and creates a **draft** GitHub Release with the `.vsix` attached.
5. Publish the GitHub Release:
   - Open the draft release in GitHub and add release notes (highlights, breaking changes, compatibility).
   - Publish the release.

## 4) Publishing to marketplaces (optional)

### VS Code Marketplace (optional)

If you publish to the Marketplace, ensure `package.json` has the correct `publisher` and that the version matches the tag/release.

1. Authenticate:
   - `npx vsce login <publisher>`
2. Publish:
   - `npx vsce publish`

Notes:
- Avoid `npx vsce publish patch/minor/major` during this flow; the version bump should already have happened in the release PR.

### Open VSX (optional)

If you publish to Open VSX, you typically use `ovsx` with a token:

- `npx ovsx publish -p "$OVSX_TOKEN"`

Token / org setup varies by publisher; document the exact token name/location in your team’s secrets manager.

## 5) Post-release verification

1. Download the `.vsix` from the GitHub Release and install it in VS Code:
   - VS Code → Extensions → `…` → “Install from VSIX…”
2. Smoke test:
   - Extension activates.
   - Basic chat flow works (local + remote, if applicable).
   - No missing-module errors.

## 6) Rollback / hotfix procedure

1. If the release is broken but the fix is small:
   - Create a hotfix PR against `develop`.
   - Cut a new patch release `X.Y.(Z+1)` using the same workflow above.
2. If you need to revert:
   - Revert the offending commit(s) on `develop` via a PR.
   - Cut a new patch release.
3. If a marketplace publish happened:
   - Follow the Marketplace/Open VSX guidance for deprecating or replacing a broken version (policies can limit unpublishing).

