// Copyright (C) 2024 Hideya Kawahara
// SPDX-License-Identifier: MIT

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { CallToolResultSchema, ListToolsResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { jsonSchemaToZod } from '@n8n/json-schema-to-zod';

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
      // schema: jsonSchemaToZod(tool.inputSchema),
      schema: mcpSchemaToZodSchema(tool.inputSchema),

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


/**
 * Converts an MCP tool to a Zod schema for LangChain
 * @param tool MCP tool
 * @returns Zod schema compatible with DynamicStructuredTool
 */
// FIXME: ad-hoc implementation
function mcpSchemaToZodSchemaAlt(tool: any): z.ZodObject<any> {
  const schema = {
    operation: z
      .enum([tool.name])
      .describe(tool.description),
  };

  for (const required of tool.inputSchema.required) {
    const prop = tool.inputSchema.properties[required];
    if (prop.type === 'number') {
      schema[required] = z.number().describe(prop.description);
    } else if (prop.type === 'string') {
      schema[required] = z.string().describe(prop.description);
    }
  }

  return z.object(schema);
}


/**
 * Converts an MCP tool schema to a Zod schema for LangChain
 * @param mcpSchema MCP tool input schema
 * @returns Zod schema compatible with DynamicStructuredTool
 */
// FIXME: not sure if the impl really correct...
// It works OK as far as I tested...
function mcpSchemaToZodSchema(mcpSchema: any): z.ZodObject<any> {
  // the top level is an object for sure
  return mcpSchemaToZodSchemaInner(mcpSchema) as z.ZodObject<any>;
}

function mcpSchemaToZodSchemaInner(mcpSchema: any): z.ZodType {
  if (!mcpSchema || typeof mcpSchema !== 'object') {
    throw new Error('Invalid schema');
  }

  // Handle enum types
  if (mcpSchema.enum) {
    return z.enum(mcpSchema.enum as [string, ...string[]]);
  }

  // Handle array types
  if (mcpSchema.type === 'array' && mcpSchema.items) {
    const itemSchema = mcpSchemaToZodSchemaInner(mcpSchema.items);
    return z.array(itemSchema);
  }

  // Handle object types
  if (mcpSchema.type === 'object' && mcpSchema.properties) {
    const shape: Record<string, z.ZodType> = {};
    
    // Convert each property
    for (const [key, prop] of Object.entries(mcpSchema.properties)) {
      shape[key] = mcpSchemaToZodSchemaInner(prop as any);
    }

    // Handle required fields
    let schema = z.object(shape);
    if (Array.isArray(mcpSchema.required)) {
      const required = mcpSchema.required;
      schema = schema.required(required);
    }

    return schema;
  }

  // Handle basic types
  if (mcpSchema.type) {
    let schema = jsonTypeToZodType(mcpSchema.type);

    // Add description if available
    if (mcpSchema.description) {
      schema = schema.describe(mcpSchema.description);
    }

    return schema;
  }

  return z.any();
}

/**
 * Converts a JSON Schema type to a Zod type
 * @param schemaType JSON Schema type string
 * @returns Corresponding Zod type
 */
function jsonTypeToZodType(schemaType: string): z.ZodType {
  switch (schemaType) {
    case 'string':
      return z.string();
    case 'number':
      return z.number();
    case 'integer':
      return z.number().int();
    case 'boolean':
      return z.boolean();
    case 'null':
      return z.null();
    case 'array':
      return z.array(z.any());
    case 'object':
      return z.object({});
    default:
      return z.any();
  }
}
