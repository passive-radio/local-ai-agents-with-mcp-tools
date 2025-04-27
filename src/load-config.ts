import JSON5 from 'json5';
import { readFileSync } from 'fs';

export interface LLMConfig {
  name: string;
  model_provider: string;
  model: string;
  description?: string;
  temperature?: number;
  max_tokens?: number;
  max_completion_tokens?: number;
}

export interface MCPServerConfig {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export interface Config {
  llm?: {
    model_provider: string;
    model: string;
    temperature?: number;
    max_tokens?: number;
    max_completion_tokens?: number;
  };
  llms?: {
    [key: string]: LLMConfig;
  };
  default_llm?: string;
  mcp_servers: {
    [key: string]: {
      command: string;
      args: string[];
      env?: {
        [key: string]: string;
      };
    };
  };
  example_queries?: string[];
}

export function loadConfig(path: string): Config {
  try {
    let json5Str = readFileSync(path, 'utf-8');

    // Replace environment variables in the format ${VAR_NAME} with their values
    Object.entries(process.env).forEach(([key, value]) => {
      json5Str = json5Str.replace(`\${${key}}`, value || '');
    });

    const config = JSON5.parse(json5Str);

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

  if ('llm' in config) {
    validateLLMConfig(config.llm);
  }

  if ('llms' in config) {
    if (typeof config.llms !== 'object' || config.llms === null) {
      throw new Error('llms must be an object');
    }
    Object.entries(config.llms).forEach(([key, value]) => {
      validateLLMConfig(value);
    });
  }

  if ('default_llm' in config && typeof config.default_llm !== 'string') {
    throw new Error('default_llm must be a string if provided');
  }

  if ('example_queries' in config) {
    if (!Array.isArray(config.example_queries)) {
      throw new Error('example_queries must be an array if provided');
    }
    if (config.example_queries.some((query: unknown) => typeof query !== 'string')) {
      throw new Error('All example queries must be strings');
    }
  }

  if (!('mcp_servers' in config)) {
    throw new Error('mcp_servers configuration is required');
  }
  if (typeof config.mcp_servers !== 'object' || config.mcp_servers === null) {
    throw new Error('mcp_servers must be an object');
  }

  Object.entries(config.mcp_servers).forEach(([key, value]) => {
    try {
      validateMCPServerConfig(value);
    } catch (error) {
      throw new Error(`Invalid configuration for MCP server "${key}": ${error instanceof Error ? error.message : String(error)}`);
    }
  });
}

function validateLLMConfig(llmConfig: unknown): asserts llmConfig is LLMConfig {
  if (typeof llmConfig !== 'object' || llmConfig === null) {
    throw new Error('LLM configuration must be an object');
  }

  if (!('model_provider' in llmConfig) || typeof llmConfig.model_provider !== 'string') {
    throw new Error('LLM model_provider must be a string');
  }

  if ('model' in llmConfig && typeof llmConfig.model !== 'string') {
    throw new Error('LLM model must be a string if provided');
  }

  if ('temperature' in llmConfig && typeof llmConfig.temperature !== 'number') {
    throw new Error('LLM temperature must be a number if provided');
  }

  if ('max_tokens' in llmConfig && typeof llmConfig.max_tokens !== 'number') {
    throw new Error('LLM max_tokens must be a number if provided');
  }

  if ('max_completion_tokens' in llmConfig && typeof llmConfig.max_completion_tokens !== 'number') {
    throw new Error('LLM max_completion_tokens must be a number if provided');
  }
}

function validateMCPServerConfig(serverConfig: unknown): asserts serverConfig is MCPServerConfig {
  if (typeof serverConfig !== 'object' || serverConfig === null) {
    throw new Error('MCP server configuration must be an object');
  }

  if (!('command' in serverConfig) || typeof serverConfig.command !== 'string') {
    throw new Error('MCP server command must be a string');
  }

  if (!('args' in serverConfig) || !Array.isArray(serverConfig.args)) {
    throw new Error('MCP server args must be an array');
  }

  if (serverConfig.args.some((arg: unknown) => typeof arg !== 'string')) {
    throw new Error('All MCP server args must be strings');
  }

  if ('env' in serverConfig && serverConfig.env !== undefined) {
    if (typeof serverConfig.env !== 'object' || serverConfig.env === null) {
      throw new Error('MCP server env must be an object if provided');
    }

    // Validate that all env values are strings
    for (const [, value] of Object.entries(serverConfig.env)) {
      if (typeof value !== 'string') {
        throw new Error('All MCP server env values must be strings');
      }
    }
  }
}
