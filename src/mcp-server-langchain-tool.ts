// Copyright (C) 2024 Hideya Kawahara
// SPDX-License-Identifier: MIT

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { CallToolResultSchema, ListToolsResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { jsonSchemaToZod, JsonSchema } from '@n8n/json-schema-to-zod';
import { z } from 'zod';

type MCPServerConfig = {
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
  allTools: DynamicStructuredTool[];
  cleanup: () => Promise<void>;
}> {
  const allTools: DynamicStructuredTool[] = [];
  const cleanupCallbacks: (() => Promise<void>)[] = [];

  const serverInitPromises = Object.entries(configs).map(async ([name, config]) => {
    // console.log(`Initializing MCP server "${name}" with: `, config, '\n');
    console.log(`Initializing MCP server "${name}"`);
    const result = await convertMCPServerToLangChainTools(name, config)
    // console.log(`Initialized MCP server "${name}"\n`);
    return {name, result};
  });

  // Track server names alongside their promises
  const serverNames = Object.keys(configs);

  // Concurrently initialize all the MCP servers
  const results = await Promise.allSettled(
    serverInitPromises
  );
  
  // Process successful initializations and log failures
  results.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      const { result: { availableTools, cleanup } } = result.value;
      allTools.push(...availableTools);
      cleanupCallbacks.push(cleanup);
    } else {
      console.error(`\x1b[31mERROR\x1b[0m: MCP server "${serverNames[index]}": failed to initialize: ${result.reason}`);
    }
  });

  async function cleanup(): Promise<void> {
    // Concurrently execute all the callbacks
    const results = await Promise.allSettled(cleanupCallbacks.map(callback => callback()));
    
    // Log any cleanup failures
    const failures = results.filter(result => result.status === 'rejected');
    if (failures.length > 0) {
      failures.forEach((failure, index) => {
        console.error(`\x1b[31mERROR\x1b[0m: MCP server "${serverNames[index]}": failed to close: ${failure.reason}`);
      });
    }
  }

  console.log(`\nMCP servers initialized and found ${allTools.length} tool(s) in total:`);
  allTools.forEach((tool) => console.log(`- ${tool.name}`));

  return { allTools, cleanup };
}

async function convertMCPServerToLangChainTools(
  serverName: string,
  config: MCPServerConfig
): Promise<{
  availableTools: DynamicStructuredTool[];
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

  console.log(`MCP server "${serverName}": connected`);

  const availableTools = toolsResponse.tools.map((tool) => (
    new DynamicStructuredTool({
      name: tool.name,
      description: tool.description || '',
      schema: jsonSchemaToZod(tool.inputSchema as JsonSchema) as z.ZodObject<any>,

      func: async (input) => {
        console.log(`\nMCP Tool "${tool.name}" received input:`, input);

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

        console.log(`MCP Tool "${tool.name}" received result:`, result);

        const filteredResult = result.content.filter(content => content.type === 'text').map((content) => {
          return content.text
        }).join('\n\n');

        // return JSON.stringify(result.content);
        return filteredResult;
      },
    })
  ));

  console.log(`MCP server "${serverName}": found ${availableTools.length} tool(s)`);

  async function cleanup(): Promise<void> {
    if (transport) {
      await transport.close();
      console.log(`Closed MCP connection to "${serverName}"`);
    }
  }

  return { availableTools, cleanup };
}
