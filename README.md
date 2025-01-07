# MCP Client Implementation Using LangChain / TypeScript [![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/hideya/react/blob/main/LICENSE)

This simple MCP-client demonstrates
[Model Context Protocol](https://modelcontextprotocol.io/) server invocations from
LangChain ReAct Agent by wrapping MCP server tools into LangChain Tools.

It leverages a utility function `convertMCPServersToLangChainTools()`
from [`@h1deya/mcp-langchain-tools`](https://www.npmjs.com/package/@h1deya/mcp-langchain-tools)

LLMs from OpenAI, Anthropic and Groq are currently supported.

## Setup
1. Install dependencies:
    ```bash
    npm install
    ```

2. Setup API keys:
    ```bash
    cp .env.template .env
    ```
    - Update `.env` as needed.
    - `.gitignore` is configured to ignore `.env`
      to prevent accidental commits of the credentials.

3. Configure LLM and MCP Servers settings `llm-mcp-config.json5` as needed.

    - The configuration file format for MCP servers is the same as
      [Claude for Desktop](https://modelcontextprotocol.io/quickstart/user) 
    - However, the format used for this app is more flexible [JSON5](https://json5.org/),
      which allows comments and trailing commas.
    - The file format is also extended to
      replace `${...}` notations with the values of corresponding environment variables.
    - Keep all the credentials and private info in the `.env` file
      and refer to them with `${...}` notation as needed.


## Usage
Development (watch) mode:
```bash
npm run dev
```
Regular mode:
```bash
npm start
```

At the prompt, you can simply press Enter to use sample queries that perform MCP server tool invocations.
