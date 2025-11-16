# Repository Guidelines

## Project Structure & Module Organization
- `src/extension.ts` is the VS Code entry point; feature logic lives in `src/connection`, `src/session`, `src/settings`, and `src/terminal`.
- The React webview sits in `src/webview-src`; `npm run compile` emits `media/webview.js` and Tailwind-generated CSS, while extension bundles land in `dist/`.
- Test harness code is under `test/`, and VS Code end-to-end specs live in `tests/e2e`; ignore generated output.
- `scripts/` holds helper tooling (for example `dev-vscode.sh`), and `docs/` contains feature reference material.

## Build, Test, and Development Commands
- `npm install` to sync dependencies.
- `npm run compile` produces the extension bundle and minified Tailwind CSS.
- `npm run watch` keeps TypeScript, Tailwind, and the webview builder running during active development.
- `npm run dev:vscode` launches the extension host with the proper environment wiring.
- Testing commands: `npm test` (Vitest unit suite), `npm run test:watch`, and `npm run e2e` (Mocha-driven VS Code integration).
- `npm run lint` and `npm run typecheck` must be clean before you push; `npm run lint:fix` can resolve formatter issues.

## Coding Style & Naming Conventions
- TypeScript (ES2022) with JSX for the webview; prefer 2-space indentation, single quotes, and trailing semicolons to match existing files.
- Follow ESLint flat-config rules (`eslint.config.js`), which enforce `prefer-const`, strict equality, and exhaustive React hook deps.
- React components and exported classes use PascalCase, hooks use `useCamelCase`, and test doubles reside in `__mocks__`.
- Never edit generated artifacts (`media/**/*`, `dist/**/*`, `tailwind.gen.css`); instead update the source `.ts(x)` or `.css`.

## Testing Guidelines
- Unit tests use Vitest with Testing Library; place specs alongside code as `*.test.ts(x)` and rely on `test/setup.ts` utilities.
- End-to-end scenarios compile to `tests/e2e/out`; clear the folder if you see stale artifacts.
- Aim for meaningful coverage of interaction paths; run `npm test -- --coverage` before release branches.
- Mock network calls with the provided fixtures in `test/__mocks__` to keep runs deterministic.

## Commit & Pull Request Guidelines
- Commits are short, imperative sentences (e.g., `Fix issue #56 with Model A` or `test(terminal): add tests`); include scopes in parentheses when clarifying context.
- Reference related GitHub issues with `(#123)` in the subject when applicable and keep bodies focused on intent plus key implementation notes.
- Pull requests should outline the rationale, list validation steps (`npm test`, `npm run lint`), and attach screenshots for webview changes.
- Ensure docs or changelog updates accompany user-visible behavior shifts.
