# Webview Host Handler Boundary

This note defines the dependency and type boundary for webview host message handlers.

## Contract

1. Shared host-handler types are defined in `src/webview/host/webviewMessageHandler.types.ts`.
2. Handler modules in `src/webview/host/handlers/*` import `CreateWebviewMessageHandlerDeps` and `WebviewHost` from `webviewMessageHandler.types.ts`.
3. Handler modules do not import from `src/webview/host/createWebviewMessageHandler.ts`.
4. `createWebviewMessageHandler.ts` is the composer/orchestrator layer and depends on handlers, not vice versa.

## Why This Exists

- Prevent import-cycle regressions between host handlers and the composer.
- Keep handler modules testable and focused on message behavior.
- Preserve a stable type surface for handler dependencies.

## Change Guidance

- If a handler needs a new dependency or callback, add it to `CreateWebviewMessageHandlerDeps` in `webviewMessageHandler.types.ts`.
- Do not "reach through" `createWebviewMessageHandler.ts` for type imports.
- Run `npm run lint:cycles` after structural changes in `src/webview/host/*`.
