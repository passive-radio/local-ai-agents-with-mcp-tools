# MCP Client Web UI with LangChain Integration [![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/hideya/mcp-langchain-client-ts/blob/main/LICENSE)

[README(日本語)](docs/README_ja.md)

This application provides a web UI for an AI agent that autonomously executes tasks by calling multiple [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) servers. The agent leverages LangChain's ReAct framework for reasoning and task execution.

## Key Features

- **Modern Web Interface**: Clean, responsive UI with dark mode support
- **Session Management**: Create and manage multiple conversation sessions
- **Multiple LLM Support**: Switch between different language models including:
  - OpenAI GPT-4.1
  - Google Gemini 2.5 Flash
  - Anthropic Claude 3.7 Sonnet
  - And other configurable options
- **Tool Integration**: Uses multiple MCP servers for enhanced functionality:
  - Web browsing and search via Brave Search
  - File system operations
  - Playwright browser automation
  - Weather data retrieval
  - Google Calendar integration
  - Time services
  - Sequential thinking tools
  - Memory persistence
- **Persistent Chat History**: Conversations saved in YAML format
- **Customizable System Prompt**: Modify the agent's behavior through system prompts

## Prerequisites

- Node.js 16+
- npm 7+ (`npx`) for Node.js-based MCP servers
- `uv` (`uvx`) for Python-based MCP servers
- Docker (for some MCP servers)
- API keys for OpenAI, Google, Anthropic, or OpenRouter
- Brave API key for web search capabilities
- Google Cloud project with Calendar API enabled (for Google Calendar integration)

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Configure API keys:
   ```bash
   cp .env.template .env
   ```
   Update the `.env` file with your API keys. This file is gitignored to protect credentials.

3. Configure LLM and MCP Servers in `llm_mcp_config.json5`:
   - The configuration uses [JSON5](https://json5.org/) format (supports comments and trailing commas)
   - Environment variables can be referenced using `${VAR_NAME}` syntax
   - Configure multiple LLM options under the `llms` section
   - Define MCP servers under the `mcp_servers` section

## Running the Application

Start the web server and UI:
```bash
npm start
```

Run in verbose mode for additional logging:
```bash
npm run start:v
```

View command-line options:
```bash
npm run start:h
```

The web UI will be available at http://localhost:3000 by default.

## MCP Server Integration

### Google Calendar Integration

This application uses [google-calendar-mcp](https://github.com/nspady/google-calendar-mcp) by nspady for Google Calendar integration. To use this feature:

1. Clone the Google Calendar MCP repository:
   ```bash
   git clone https://github.com/nspady/google-calendar-mcp.git
   cd google-calendar-mcp
   ```

2. Set up the Google Calendar MCP server:
   - Follow the instructions in the repository to set up a Google Cloud project and enable the Calendar API
   - Create OAuth 2.0 credentials (Client ID and Client Secret)
   - Download your OAuth credentials to `gcp-oauth.keys.json`
   - Install dependencies with `npm install`
   - Run the authentication flow with `npm run auth`
   - Build the project with `npm run build`

3. Update your `llm_mcp_config.json5` to include the local Google Calendar MCP server:
   ```json
   "google-calendar": {
     "command": "node",
     "args": ["<absolute-path-to-project-folder>/build/index.js"]
   }
   ```
   Replace `<absolute-path-to-project-folder>` with the actual path to your google-calendar-mcp directory.

4. The agent will now be able to create, read, update and search for calendar events through natural language commands.

## Usage

1. Open the web interface in your browser
2. Select or create a conversation session
3. Choose your preferred LLM model
4. Type your message and send
5. The agent will analyze your request and use appropriate tools to fulfill it
6. For complex tasks, the agent will break them down into subtasks using the sequential thinking tool

## Example Queries

- "What's tomorrow's weather in San Francisco?"
- "Find and summarize the latest news about AI technology"
- "Find a restaurant with availability for 4 people tomorrow evening in Shibuya"
- "Create a calendar event for a team meeting next Monday at 2pm"
- "Read and explain the content of a specific file in this project"
- "Show me my schedule for next week and identify any conflicts"
- "Add a reminder for my dentist appointment on Friday at 3pm"
- "Find a suitable time for a meeting with the team next week"

## Configuration

You can customize the agent's behavior by modifying the system prompt in the settings panel. The application supports different language models which can be configured in the `llm_mcp_config.json5` file.

## License

This project is licensed under the MIT License - see the LICENSE file for details.
