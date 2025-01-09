import { ChatAnthropic } from '@langchain/anthropic';
import { ChatOpenAI } from '@langchain/openai';
import { ChatGroq } from '@langchain/groq';
import { BaseChatModel, BindToolsInput } from '@langchain/core/language_models/chat_models';

// FIXME: no typescript version of init_chat_model()?
// Ref: https://python.langchain.com/api_reference/langchain/chat_models/langchain.chat_models.base.init_chat_model.html

interface ChatModelConfig {
  provider: string;
  apiKey?: string;
  modelName?: string;
  temperature?: number;
  maxTokens?: number,
  tools?: BindToolsInput[];
}

export function initChatModel(config: ChatModelConfig): BaseChatModel {
  let model: BaseChatModel;

  // remove unnecessary properties
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { provider, tools, ...llmConfig } = config;

  try {
    switch (config.provider.toLowerCase()) {
      case 'openai':
        model = new ChatOpenAI(llmConfig);
        break;

      case 'anthropic':
        model = new ChatAnthropic(llmConfig);
        break;

      case 'groq':
        // somehow, the API key had to be set via the env variable,
        // even though the constructor accepts `apiKey`
        if (llmConfig.apiKey) {
          process.env.GROQ_API_KEY = llmConfig.apiKey;
        }
        model = new ChatGroq(llmConfig);
        break;

      default:
        throw new Error(
          `Unsupported provider: ${config.provider}`,
        );
    }

    if (typeof model?.bindTools === 'function') {
      if (config.tools && config.tools.length > 0) {
        // FIXME
        // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
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
