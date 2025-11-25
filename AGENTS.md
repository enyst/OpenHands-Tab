# OpenHands-Tab for AI Agents

Essential information for working with this codebase.

## Prerequisites

- Node.js 22 LTS (npm >= 10)
- VS Code >= 1.104


## Quick Commands

```bash
# Install
npm ci

# Build everything (SDK + extension + webview)
npm run build

# Run tests
npm test

# Lint
npm run lint

# Type check
npm run typecheck

# Development watch mode
npm run watch

### Targeted tests

When only specific tests are relevant (e.g., during reviews):

```bash
npx vitest run src/webview-src/__tests__/event.handlers.test.tsx
```


# Launch extension in VS Code
# Press F5 in VS Code, or:
code "$(pwd)" --extensionDevelopmentPath="$(pwd)"
```

## Tooling

If tooling is missing in your environment:

- Install Node 22 (e.g., with nvm: `nvm install 22 && nvm use 22`, or via tarball)
- Ensure `node` and `npm` are on PATH

## Project Structure
```
OpenHands-Tab/
├── src/                          # Extension source
│   ├── extension.ts              # VS Code entry point
│   ├── __tests__/                # Unit tests (Vitest)
│   ├── connection/               # ConnectionManager
│   ├── session/                  # ConversationManager
│   ├── settings/                 # SettingsManager, adapters
│   ├── sidebar/                  # Activity bar view provider
│   └── webview-src/              # React webview UI
│       └── components/           # App, EventBlock, InputArea, etc.
├── packages/agent-sdk-ts/        # TypeScript SDK
│   └── src/
│       ├── conversation/         # Conversation API (primary)
│       ├── context/              # AgentContext, Skills
│       ├── runtime/              # Orchestrator, EventLog, State
│       ├── llm/                  # LLM clients (Anthropic, OpenAI)
│       ├── tools/                # Terminal, FileEditor, etc.
│       └── types/                # Protocol types, guards
├── tests/e2e/                    # E2E tests (Mocha)
├── docs/                         # Documentation
└── media/                        # Icons, built webview assets
```

## Key Files

- `src/extension.ts` - Extension activation, commands
- `src/webview-src/components/App.tsx` - Main webview component
- `packages/agent-sdk-ts/src/conversation/` - Conversation API
- `package.json` - Commands, settings schema, dependencies

## Coding Style

- TypeScript ES2022, 2-space indent, single quotes, trailing semicolons
- React functional components with hooks
- Follow existing ESLint config (`eslint.config.js`)
- Don't edit generated files: `dist/`, `media/webview.js`, `tailwind.gen.css`

## Testing

- Unit tests: Vitest (`npm test`)
- E2E tests: `npm run e2e` (Mocha + @vscode/test-electron)
- Place tests in `__tests__/` directories alongside source

## Commits

Short imperative sentences. Reference issues with `(#123)`.

```bash
# Multi-paragraph commits
git commit -m 'Subject' -m 'Body paragraph'
```

Do not use literal `\n` in commit messages.

## SDK Package

When editing `packages/agent-sdk-ts`, rebuild before launching extension:
```bash
npm run build -w @openhands/agent-sdk-ts
```

## Further Reading

- [docs/PRD.md](docs/PRD.md) - Product requirements
- [docs/agent-sdk-architecture.md](docs/agent-sdk-architecture.md) - SDK architecture
- [docs/vscode_local_setup.md](docs/vscode_local_setup.md) - Local development setup
- [packages/agent-sdk-ts/AGENTS.md](packages/agent-sdk-ts/AGENTS.md) - SDK-specific guidelines
