# MCP Client Implementation In LangChain / TypeScript

This simple app demonstrates
[Model Context Protocol](https://modelcontextprotocol.io/) server invocations from
LangChain ReAct Agent by wrapping MCP server tools into LangChain Tools.

LLMs from OpenAI, Anthropic and Groq are currently supported.

## Features

A utility function `convertMCPServersToLangChainTools()` was introduced to simplify the work.

It accepts the MCP server configuration in the same format
as [Claude for Desktop](https://modelcontextprotocol.io/quickstart/user),
a JS Object version of its JSON configuration file, i.e.:

```ts
const serverConfig: MCPServersConfig = {
  filesystem: {
    command: 'npx',
    args: [
      '-y',
      '@modelcontextprotocol/server-filesystem',
      '/Users/username/Desktop'
    ]
  },
  other_mcp_server: {
    ...
  }
};

const {allTools, cleanup} = await convertMCPServersToLangChainTools(serverConfig);
```

The utility functoin initializes all the MCP server connections concurrently,
and returns LangChain Tools (`allTools: Tool[]`) by gathering all the available MCP Server tools,
and by wrapping them into LangChain Tools (it also returns `cleanup` callback function
that is used to close connections to MCP servers when finished).

The returned tools can be used by LangChain, e.g.:

```ts
const agent = createReactAgent({
  llm: llmModel,
  tools: allTools,
  checkpointSaver: new MemorySaver()
});
```

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

    - The configuration file format is [JSON5](https://json5.org/),
      where comments and trailing commas are allowed.
    - The file format is further extended to
      replace `${...}` notations with the values of appropriate environment variables.



## Usage
Development mode:
```bash
npm run dev
```
