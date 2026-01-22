# OpenHands Tab (prototype)

OpenHands Tab Prototype is a VS Code extension that lets you work with your OpenHands agents in a dedicated sidebar.

## Quick start

1. Install the extension.
2. Open the view: **OpenHands: Open** (or click the OpenHands icon in the Activity Bar).
3. Choose a mode:
   - **Local mode**: leave the server URL blank.
   - **Remote mode**: set a server URL (agent-server / OpenHands server) and authenticate as needed.

> **Warning:** The main developer of OpenHands-Tab is OpenHands itself, for fun and experimentation.
> You should consider it a prototype.

## Configuration

Open **VS Code Settings** or use **LLM Profiles** to set:
- LLM provider API keys (OpenAI / Anthropic / OpenRouter / LiteLLM / Gemini)
- Strongly recommended for best experience: set a Gemini key even if you choose a different main LLM (for summarizations)
- Remote server URL (optional)
- GitHub token (optional, recommended)

## Links

- Repo: https://github.com/enyst/OpenHands-Tab
- Agent SDK: https://github.com/OpenHands/software-agent-sdk
