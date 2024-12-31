// Copyright (C) 2024 Hideya Kawahara
// SPDX-License-Identifier: MIT

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { CallToolResultSchema, ListToolsResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { DynamicStructuredTool, Tool } from "@langchain/core/tools";

export type MCPServerConfig = {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export type MCPServersConfig = {
  [key: string]: MCPServerConfig;
}

export async function convertMCPServersToLangChainTools(
  configs: MCPServersConfig
): Promise<{
  allTools: Tool[];
  cleanup: () => Promise<void>;
}> {
  const allTools: Tool[] = [];
  const cleanupCallbacks: (() => Promise<void>)[] = [];

  // Concurrently initialize all the MCP servers
  const results = await Promise.allSettled(
    Object.entries(configs).map(async ([name, config]) => {
      console.log(`Initializing MCP server "${name}" with: `, config, '\n');
      return {
        name,
        result: await convertMCPServerToLangChainTools(name, config)
      };
    })
  );
  
  // Process successful initializations and log failures
  for (const result of results) {
    if (result.status === 'fulfilled') {
      const { result: { availableTools, cleanup } } = result.value;
      allTools.push(...availableTools);
      cleanupCallbacks.push(cleanup);
    } else {
      console.error(`Failed to initialize MCP server: ${result.reason}`);
    }
  }

  async function cleanup(): Promise<void> {
    // Concurrently execute all the callbacks
    const results = await Promise.allSettled(cleanupCallbacks.map(callback => callback()));
    
    // Log any cleanup failures
    const failures = results.filter(result => result.status === 'rejected');
    if (failures.length > 0) {
      console.error(`${failures.length} cleanup callback(s) failed:`);
      failures.forEach((failure, index) => {
        console.error(`Cleanup failure ${index + 1}:`, failure.reason);
      });
    }
  }

  return { allTools, cleanup };
}

async function convertMCPServerToLangChainTools(
  serverName: string,
  config: MCPServerConfig
): Promise<{
  availableTools: Tool[];
  cleanup: () => Promise<void>;
}> {

  const transport = new StdioClientTransport(
    {
      command: config.command,
      args: config.args,
      env: config.env,
    },
  );

  const client = new Client(
    {
      name: "mcp-client",
      version: "0.0.1",
    },
    {
      capabilities: {},
    }
  );

  await client.connect(transport);

  const toolsResponse = await client.request(
    { method: "tools/list" },
    ListToolsResultSchema
  );

  console.log(`Connected to server "${serverName}" with ${toolsResponse.tools.length} tools\n`);

  const availableTools = toolsResponse.tools.map((tool: any) => (
    new DynamicStructuredTool({
      name: tool.name,
      description: tool.description,
      schema: tool.inputSchema,

      func: async (input) => {
        console.log(`\nTool "${tool.name}" received input:`, input);

        if (Object.keys(input).length === 0) {
          return 'No input provided';
        }

        // Execute tool call
        const result = await client.request(
          {
            method: "tools/call",
            params: {
              name: tool.name,
              arguments: input,
            },
          },
          CallToolResultSchema
        );

        console.log(`Tool "${tool.name}" received result:`, result);

        return JSON.stringify(result.content);
      },
    })
  ));

  async function cleanup(): Promise<void> {
    if (transport) {
      await transport.close();
      console.log(`Closed MCP connection to "${serverName}"`);
    }
  }

  return { availableTools, cleanup };
}
