# OpenHands-Tab Prototype

A VS Code extension that brings the power of OpenHands AI agents directly into your development environment. This extension provides an alternative way to interact with the [OpenHands agent-sdk](https://github.com/All-Hands-AI/agent-sdk), without leaving your IDE.

## Getting Started

### Prerequisites

- Visual Studio Code 1.85.0 or higher
- Node.js 22.x or higher
- Python 3.12+ (for agent-sdk backend)
- Access to an LLM provider (OpenAI, Anthropic, or self-hosted)

### Installation

1. Clone this repository:
   ```bash
   git clone https://github.com/enyst/OpenHands-Tab.git
   cd OpenHands-Tab
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Set up the agent-sdk backend (see [agent-sdk documentation](https://github.com/All-Hands-AI/agent-sdk))

### Development

1. Open the project in VSCode
2. Press `F5` to launch a new Extension Development Host
3. The extension will be available in the new VSCode window
