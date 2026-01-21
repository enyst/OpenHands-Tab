# OpenHands Tab

OpenHands Tab is a VS Code extension that lets you chat with OpenHands agents in a dedicated sidebar.

## Quick start

1. Install the extension.
2. Open the view: **OpenHands: Open** (or click the OpenHands icon in the Activity Bar).
3. Choose a mode:
   - **Local mode**: leave the server URL blank.
   - **Remote mode**: set a server URL (agent-server / OpenHands server) and authenticate as needed.

## Configuration

Run the **OpenHands: Configure** command (or use the individual commands) to set:
- LLM provider API keys (OpenAI / Anthropic / OpenRouter / LiteLLM / Gemini)
- Remote server URL (optional)
- Session API key (for some remote setups)
- GitHub token (optional)

## Troubleshooting

- If the sidebar doesn’t appear, run **OpenHands: Open** from the Command Palette.
- If you’re connecting remotely, double-check the server URL and authentication settings.

## Links

- Repo: https://github.com/enyst/OpenHands-Tab
- Agent SDK: https://github.com/OpenHands/software-agent-sdk
