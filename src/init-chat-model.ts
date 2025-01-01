// Copyright (C) 2024 Hideya Kawahara
// SPDX-License-Identifier: MIT

import { ChatOpenAI } from '@langchain/openai';
import { ChatAnthropic } from '@langchain/anthropic';
import { ChatGroq } from '@langchain/groq';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { Tool } from '@langchain/core/tools';

// FIXME: no typescript version of init_chat_model() yet?
// Ref: https://python.langchain.com/api_reference/langchain/chat_models/langchain.chat_models.base.init_chat_model.html
// Ref: https://v03.api.js.langchain.com/classes/_langchain_core.language_models_chat_models.BaseChatModel.html

interface InitChatModelConfig {
  modelName: string;
  provider: string;
  // apiKey: string;
  temperature: number;
  tools?: Tool[];
}

export function initChatModel(config: InitChatModelConfig): BaseChatModel {

  let model: BaseChatModel;

  try {
    switch (config.provider.toLowerCase()) {
      case 'openai':
        model = new ChatOpenAI({
          modelName: config.modelName,
          temperature: config.temperature,
          // openAIApiKey: config.apiKey,
        });
        break;

      case 'anthropic':
        model = new ChatAnthropic({
          modelName: config.modelName,
          temperature: config.temperature,
          // anthropicApiKey: config.apiKey,
        });
        break;

      case 'groq':
        // Groq library requires the API key set by the env variable
        // process.env.GROQ_API_KEY = config.apiKey;
        model = new ChatGroq({
          modelName: config.modelName,
          temperature: config.temperature,
        });
        break;

      default:
        throw new Error(
          `Unsupported provider: ${config.provider}`,
        );
    }

    if (typeof model?.bindTools === 'function') {
      if (config.tools && config.tools.length > 0 ) {
        model = (model as { bindTools: Function }).bindTools(config.tools);
      }
    } else {
      throw new Error(
        `Tool calling unsupported by provider: ${config.provider}`,
      );
    }

    return model;
  } catch (error) {
    throw new Error(`Failed to initialize chat model: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}
