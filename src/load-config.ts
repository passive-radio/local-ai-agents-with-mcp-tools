// Copyright (C) 2024 Hideya Kawahara
// SPDX-License-Identifier: MIT

import JSON5 from 'json5';
import { readFileSync } from 'fs';

export type LLMConfig = {
  model: string;
  provider: string;
  temperature: number;
}

export type MCPServerConfig = {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export type Config = {
  llm: LLMConfig;
  mcpServers: {
    [key: string]: MCPServerConfig;
  }
}

export function loadConfig(path: string): Config {
  try {
    let json5Str = readFileSync(path, 'utf-8');

    // Replace environment variables in the format ${VAR_NAME} with their values
    Object.entries(process.env).forEach(([key, value]) => {
      json5Str = json5Str.replace(`\${${key}}`, value || '');
    });

    const config = JSON5.parse(json5Str) as Config;

    // Validate required fields
    validateConfig(config);

    return config;
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to load configuration from "${path}": ${error.message}`);
    }
    throw error;
  }
}

function validateConfig(config: unknown): asserts config is Config {
  if (typeof config !== 'object' || config === null) {
    throw new Error('Configuration must be an object');
  }

  const fullConfig = config as any;
  
  if (!fullConfig.llm) {
    throw new Error('LLM configuration is required');
  }
  validateLLMConfig(fullConfig.llm);
  
  if (typeof fullConfig.mcpServers !== 'object' || fullConfig.mcpServers === null) {
    throw new Error('mcpServers must be an object');
  }
  
  Object.entries(fullConfig.mcpServers).forEach(([key, value]) => {
    try {
      validateMCPServerConfig(value);
    } catch (error) {
      throw new Error(`Invalid configuration for MCP server "${key}": ${error instanceof Error ? error.message : String(error)}`);
    }
  });
}

function validateLLMConfig(config: unknown): asserts config is LLMConfig {
  if (typeof config !== 'object' || config === null) {
    throw new Error('LLM configuration must be an object');
  }

  const llmConfig = config as any;
  
  if (typeof llmConfig.model !== 'string') {
    throw new Error('LLM model must be a string');
  }
  
  if (typeof llmConfig.provider !== 'string') {
    throw new Error('LLM provider must be a string');
  }
  
  if (typeof llmConfig.temperature !== 'number') {
    throw new Error('LLM temperature must be a number');
  }
}

function validateMCPServerConfig(config: unknown): asserts config is MCPServerConfig {
  if (typeof config !== 'object' || config === null) {
    throw new Error('MCP server configuration must be an object');
  }

  const serverConfig = config as any;
  
  if (typeof serverConfig.command !== 'string') {
    throw new Error('MCP server command must be a string');
  }
  
  if (!Array.isArray(serverConfig.args)) {
    throw new Error('MCP server args must be an array');
  }
  
  if (serverConfig.args.some(arg => typeof arg !== 'string')) {
    throw new Error('All MCP server args must be strings');
  }
  
  if (serverConfig.env !== undefined && (typeof serverConfig.env !== 'object' || serverConfig.env === null)) {
    throw new Error('MCP server env must be an object if provided');
  }
}
