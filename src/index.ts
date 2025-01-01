// Copyright (C) 2024 Hideya Kawahara
// SPDX-License-Identifier: MIT

import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { MemorySaver } from '@langchain/langgraph';
import { HumanMessage } from '@langchain/core/messages';

import { convertMCPServersToLangChainTools } from './mcp-server-langchain-tool';
import { loadConfig } from './load-config';
import { initChatModel } from './init-chat-model';

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
    config: {
      type: 'string',
      description: 'Path to config file',
      demandOption: false,
    }
  })
  .help()
  .alias('help', 'h')
  .parseSync() as Arguments;

const configPath = argv.config || './llm-mcp-config.json5';

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

  const {allTools, cleanup} = await convertMCPServersToLangChainTools(config.mcpServers);

  cleanupMCPConnections = cleanup;

  const agent = createReactAgent({
    llm: llmModel,
    tools: allTools,
    // Initialize memory to persist state between graph runs
    checkpointSaver: new MemorySaver(),
  });

  console.log();

  const queries = [
    // 'how many files in the src directory?',
    // 'read and briefly summarize the file ./LICENSE',
    // 'whats written on cnn.com?',
    'whats the weather in sf?',
  ]

  for (const query of queries) {
    console.log(`\x1b[33mQuery: ${query}\x1b[0m`);

    const agentFinalState = await agent.invoke(
      { messages: [new HumanMessage(query)] },
      { configurable: { thread_id: 'test-thread' } },
    );

    const result = agentFinalState.messages[agentFinalState.messages.length - 1].content;

    console.log(`\n\x1b[36m${result}\x1b[0m\n`);
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
