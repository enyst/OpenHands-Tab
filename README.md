# OpenHands-Tab

A Visual Studio Code extension that brings the power of OpenHands AI agents directly into your development environment. This extension provides an alternative way to interact with the [OpenHands agent-sdk](https://github.com/All-Hands-AI/agent-sdk), allowing developers to leverage AI agents for coding tasks without leaving their IDE.

## Overview

This project is built on the clean, modular architecture of the OpenHands Agent SDK, which provides:

- **Core SDK functionality**: Agents, conversations, LLM integration, and tool system
- **Runtime tools**: BashTool, FileEditorTool, TaskTrackerTool, BrowserToolSet
- **REST API and WebSocket server**: For remote agent interactions

The OpenHands-Tab extension serves as a user-friendly interface layer that connects VSCode with these powerful agent capabilities, enabling seamless AI-assisted development workflows.

## Architecture

The extension leverages the OpenHands Agent SDK's three main packages:

1. **`openhands-sdk`**: Core functionality for agent orchestration
2. **`openhands-tools`**: Runtime tool implementations for file editing, bash execution, task tracking, and browser automation
3. **`openhands-agent-server`**: REST API and WebSocket server for communication

### Agent Capabilities

Through the agent-sdk integration, the extension provides access to:

- **File Operations**: Create, edit, and manage files with intelligent suggestions
- **Terminal Integration**: Execute bash commands and manage shell sessions
- **Task Management**: Organize and track development tasks systematically
- **Browser Automation**: Automate web interactions for testing and research
- **Multi-LLM Support**: Work with various language models through a unified interface

## Key Features (Planned)

- 🤖 **AI Agent Integration**: Direct access to OpenHands agents from VSCode
- 📝 **Intelligent Code Editing**: AI-powered file operations and code suggestions
- 🖥️ **Terminal Management**: Execute and manage bash commands through AI agents
- 📋 **Task Tracking**: Organize development tasks with AI assistance
- 🌐 **LLM Flexibility**: Support for multiple language model providers
- 💬 **Conversation Management**: Persistent chat sessions with agents
- 🔧 **Tool Ecosystem**: Extensible tool system for custom workflows
- ⚡ **Real-time Communication**: WebSocket-based real-time agent interactions

## Getting Started

### Prerequisites

- Visual Studio Code 1.85.0 or higher
- Node.js 18.x or higher
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

## Configuration

The extension will support configuration through VSCode settings:

- **LLM Provider**: Choose your preferred language model
- **Agent Presets**: Select default tools and configurations
- **Working Directory**: Set the context for agent operations
- **API Keys**: Securely store LLM provider credentials

## OpenHands Agent SDK Integration

This extension is designed to work seamlessly with the OpenHands Agent SDK architecture:

### Agent Presets
```python
# The extension will utilize default agent presets
from openhands.sdk.preset.default import get_default_agent

agent = get_default_agent(
    llm=llm,
    working_dir=workspace_root,
    cli_mode=True,
)
```

### Conversation Management
```python
# Persistent conversations through the extension
from openhands.sdk import Conversation

conversation = Conversation(agent=agent)
conversation.send_message(user_input)
conversation.run()
```

### Tool Integration
The extension provides access to all agent-sdk tools:
- **BashTool**: Execute commands in VSCode's integrated terminal
- **FileEditorTool**: Edit files with AI assistance
- **TaskTrackerTool**: Manage development tasks and TODOs
- **BrowserToolSet**: Automate browser-based workflows

## Contributing

This project is in active development. Contributions are welcome!

1. Fork the repository
2. Create a feature branch: `git checkout -b feature-name`
3. Make your changes and add tests
4. Submit a pull request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Related Projects

- [OpenHands Agent SDK](https://github.com/All-Hands-AI/agent-sdk) - The core agent framework
- [OpenHands](https://github.com/All-Hands-AI/OpenHands) - The main OpenHands project
- [All-Hands-AI Documentation](https://docs.all-hands.dev/) - Comprehensive documentation

## Acknowledgments

Built on the powerful foundation of the OpenHands Agent SDK, which provides a clean, modular approach to AI agent development. Special thanks to the All-Hands-AI team for creating such a well-architected framework.
