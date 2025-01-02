// Copyright (C) 2024 Hideya Kawahara
// SPDX-License-Identifier: MIT

import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { MemorySaver } from '@langchain/langgraph';
import { HumanMessage } from '@langchain/core/messages';

import { convertMCPServersToLangChainTools } from './mcp-server-langchain-tool';
import { loadConfig } from './load-config';
import { initChatModel } from './init-chat-model';

import readline from 'readline';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import dotenv from 'dotenv';
dotenv.config();

interface Arguments {
  config: string;
  [key: string]: unknown;
}

const argv = yargs(hideBin(process.argv))
  .options({
    config: {type: 'string', description: 'Path to config file', demandOption: false},
  })
  .help()
  .alias('help', 'h')
  .parseSync() as Arguments;

const configPath = argv.config || process.env.CONFIG_FILE || './llm-mcp-config.json5';

let cleanupMCPConnections: () => Promise<void>;

async function main() {

  const config = loadConfig(configPath);

  const llmConfig = config.llm;

  console.log('Initializing model...', llmConfig, '\n');
  const llmModel = initChatModel({
    modelName: llmConfig.model,
    provider: llmConfig.provider,
    temperature: llmConfig.temperature,
  });

  const { allTools, cleanup } = await convertMCPServersToLangChainTools(
    config.mcpServers,
    { logLevel: 'info' }
  );

  cleanupMCPConnections = cleanup;

  const agent = createReactAgent({
    llm: llmModel,
    tools: allTools,
    // Initialize memory to persist state between graph runs
    checkpointSaver: new MemorySaver(),
  });

  console.log('\nConversation started. Type "exit" to end the conversation.\n');

  const sampleQueries = [
    'How many files in the src directory?',
    'Read and briefly summarize the file ./LICENSE',
    // 'Whats the news headlines on cnn.com?',
    // 'Whats the weather in sf?',
  ];

  if (sampleQueries.length > 0) {
    console.log('Sampale Queries:');
    sampleQueries.forEach(query => {
      console.log(`- ${query}`);
    });
    console.log();
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  
  const getInput = (query: string): Promise<string> => 
    new Promise<string>((resolve: (value: string) => void) => 
      rl.question(query, resolve));  

  while (true) {
    let query = (await getInput('\x1b[33mQuery: ')).trim();

    if (query.toLowerCase() === 'exit') {
      console.log('\n\x1b[36mGoodbye!\x1b[0m\n');
      rl.close();
      break;
    }

    if (query === '') {
      const sampleQuery = sampleQueries.shift();
      if (!sampleQuery) {
        console.log('\x1b[0m\nPlease enter a query, or "exit" to exit\n');
        continue;
      }
      query = sampleQuery;
      console.log(`\x1b[33mSampale Query: ${query}`);
    }

    console.log('\x1b[0m');

    const agentFinalState = await agent.invoke(
      { messages: [new HumanMessage(query)] },
      { configurable: { thread_id: 'test-thread' } },
    );

    const result = agentFinalState.messages[agentFinalState.messages.length - 1].content;

    console.log(`\x1b[36m${result}\x1b[0m\n`);
  }

  await cleanupMCPConnections();
}

main().catch(async (error: unknown) => {
  if (error instanceof Error) {
    console.error(error.message);
  } else {
    console.error('An unknown error occurred', error);
  }
  if (cleanupMCPConnections) {
    await cleanupMCPConnections();
  }
});
