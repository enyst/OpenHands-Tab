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
   - Recommended: use the repo-supported Node version to avoid toolchain warnings:
     - `node --version` (should satisfy `package.json#engines.node`)
2. Create a release branch:
   - `git switch -c release/X.Y.Z`
   - If you merged a last-minute fix PR into `develop` while the release PR is open, rebase the release branch before packaging:
     - `git fetch origin && git rebase origin/develop`
3. Bump versions:
   - Extension (root): `package.json` + `package-lock.json`
   - SDK (workspace): `packages/agent-sdk-ts/package.json` (and lockfile updates as needed)
   - Prefer:
     - `npm version X.Y.Z --no-git-tag-version`
     - `npm version X.Y.Z --no-git-tag-version -w @smolpaws/agent-sdk`
   - Alternatively, edit the `package.json` files manually, then run `npm i --package-lock-only`
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
   - Note: packaging uses `README.vscode.md` for the extension’s “Readme” tab in VS Code (separate from the repo `README.md`).
   - If you see a VSIX error about “same case insensitive path” for README files, ensure the repo `README.md` is excluded from the VSIX via `.vscodeignore`.
6. (Optional but recommended) Smoke test the VSIX like a user (non-dev, non-debug):
   - Install the built VSIX into your normal VS Code profile:
     - `code --install-extension ./openhands-tab-X.Y.Z.vsix`
   - Restart VS Code normally (no `--extensionDevelopmentPath`):
     - `code -n "$(pwd)"`
   - In VS Code: confirm the extension is installed/enabled, then try a basic chat flow.

## 2) Release PR workflow (GitHub)

**Important**: A release PR with version bumps is required. Do not tag directly without merging the release PR first.

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
6. **Squash-merge** the PR into `develop` (this repo uses squash merges).
   - The resulting squashed commit on `develop` is what you will tag in the next step.

## 3) Tagging + GitHub Release (recommended path)

**Important**: Only tag after the release PR has been squash-merged. The tag must point to the squash-merged commit on `develop`.

This repo’s `Build VSIX (PRs and develop)` workflow is configured to run the release job only for tags matching:
- `X.Y.Z` (example: `0.6.1`)

It will **not** match `vX.Y.Z` unless the workflow is changed.

1. Update local `develop` to include the merged release PR:
   - `git switch develop && git pull`
2. Verify HEAD is the squash-merged release commit:
   - `git log -1 --oneline` (should show the release commit)
3. Create the tag on `develop` HEAD:
   - `git tag X.Y.Z`
4. Push the tag:
   - `git push origin X.Y.Z`
5. ⏳ Wait for the tag build to complete (~10–20 minutes depending on CI load).
   - `build-vsix.yml` verifies the tag name equals `package.json` version.
   - It builds/tests, packages the `.vsix`, uploads it as an artifact, and creates a **draft** GitHub Release with the `.vsix` attached.
   - Note: the draft release URL may show an `untagged-…` slug; confirm `tagName` is `X.Y.Z` and that the `.vsix` asset is present before publishing.
6. Publish the GitHub Release:
   - Open the draft release in GitHub and add release notes (highlights, breaking changes, compatibility).
   - **Include contributors**: Add a "Contributors" section listing everyone who contributed to this release. Use `git shortlog -sne <previous-tag>..HEAD` to generate the list, or use GitHub's "Generate release notes" feature as a starting point.
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
