// Copyright (C) 2024 Hideya Kawahara
// SPDX-License-Identifier: MIT

import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { MemorySaver } from '@langchain/langgraph';
import { HumanMessage } from '@langchain/core/messages';
import { convertMCPServersToLangChainTools, MCPServerCleanupFunction } from './mcp-server-langchain-tool';
import { initChatModel } from './init-chat-model';
import { loadConfig, Config } from './load-config';
import readline from 'readline';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import dotenv from 'dotenv';

// Initialize environment variables
dotenv.config();

// Constants
const DEFAULT_CONFIG_PATH = './llm-mcp-config.json5';

const SAMPLE_QUERIES = [
  'Read and briefly summarize the file ./LICENSE',
  'Read the news headlines on cnn.com?',
  // 'Show me the page cnn.com',
  // 'Whats the weather in SF?',
] as const;

const CONSOLE_COLORS = {
  YELLOW: '\x1b[33m',
  CYAN: '\x1b[36m',
  RESET: '\x1b[0m'
} as const;

// CLI argument setup
interface Arguments {
  config: string;
  [key: string]: unknown;
}

const parseArguments = (): Arguments => {
  return yargs(hideBin(process.argv))
    .options({
      config: {
        type: 'string',
        description: 'Path to config file',
        demandOption: false
      },
    })
    .help()
    .alias('help', 'h')
    .parseSync() as Arguments;
};

// Input handling
const createReadlineInterface = () => {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
};

const getInput = (rl: readline.Interface, prompt: string): Promise<string> => {
  return new Promise((resolve) => rl.question(prompt, resolve));
};

// Console output helpers
const log = {
  color: (text: string, color: keyof typeof CONSOLE_COLORS) => 
    `${CONSOLE_COLORS[color]}${text}${CONSOLE_COLORS.RESET}`,
  printSampleQueries: (queries: readonly string[]) => {
    if (queries.length === 0) return;
    console.log('Sample Queries (type just enter to supply them one by one):');
    queries.forEach(query => console.log(`- ${query}`));
    console.log();
  }
};

// Conversation loop
async function handleConversation(
  agent: ReturnType<typeof createReactAgent>,
  rl: readline.Interface,
  remainingQueries: string[]
): Promise<void> {
  while (true) {
    const input = await getInput(rl, log.color('Query: ', 'YELLOW'));
    const query = input.trim();

    if (query.toLowerCase() === 'quit' || query.toLowerCase() === 'q') {
      console.log(log.color('\nGoodbye!\n', 'CYAN'));
      rl.close();
      break;
    }

    if (query === '') {
      const sampleQuery = remainingQueries.shift();
      if (!sampleQuery) {
        console.log('\nPlease type a query, or "quit" or "q" to exit\n');
        continue;
      }
      console.log(log.color(`Sample Query: ${sampleQuery}`, 'YELLOW'));
      await processQuery(agent, sampleQuery);
      continue;
    }

    await processQuery(agent, query);
  }
}

async function processQuery(
  agent: ReturnType<typeof createReactAgent>,
  query: string
): Promise<void> {
  console.log(CONSOLE_COLORS.RESET);
  
  const agentFinalState = await agent.invoke(
    { messages: [new HumanMessage(query)] },
    { configurable: { thread_id: 'test-thread' } }
  );

  const result = agentFinalState.messages[agentFinalState.messages.length - 1].content;

  console.log(log.color(`${result}\n`, 'CYAN'));
}

// Application initialization
async function initialize(config: Config) {
  console.log('Initializing model...', config.llm, '\n');
  const llmModel = initChatModel(config.llm);

  console.log(`Initializing ${Object.keys(config.mcpServers).length} MCP server(s)...\n`);
  const { allTools, cleanup } = await convertMCPServersToLangChainTools(
    config.mcpServers,
    { logLevel: 'info' }
  );

  const agent = createReactAgent({
    llm: llmModel,
    tools: allTools,
    checkpointSaver: new MemorySaver(),
  });

  return { agent, cleanup };
}

// Main
async function main(): Promise<void> {
  let mcpCleanup: MCPServerCleanupFunction | undefined;

  try {
    const argv = parseArguments();
    const configPath = argv.config || process.env.CONFIG_FILE || DEFAULT_CONFIG_PATH;
    const config = loadConfig(configPath);

    const { agent, cleanup } = await initialize(config);
    mcpCleanup = cleanup;

    console.log('\nConversation started. Type "quit" or "q" to end the conversation.\n');
    log.printSampleQueries(SAMPLE_QUERIES);

    const rl = createReadlineInterface();
    await handleConversation(agent, rl, [...SAMPLE_QUERIES]);
    
  } finally {
    if (mcpCleanup) {
      await mcpCleanup();
    }
  }
}

// Application entry point with error handling
main().catch((error: unknown) => {
  const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
  console.error(errorMessage, error);
  process.exit(1);
});
