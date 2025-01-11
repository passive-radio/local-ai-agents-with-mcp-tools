import { ChatAnthropic } from '@langchain/anthropic';
import { ChatOpenAI } from '@langchain/openai';
import { ChatGroq } from '@langchain/groq';
import { BaseChatModel, BindToolsInput } from '@langchain/core/language_models/chat_models';

// FIXME: no typescript version of init_chat_model()?
// Ref: https://python.langchain.com/api_reference/langchain/chat_models/langchain.chat_models.base.init_chat_model.html

interface ChatModelConfig {
  model_provider: string;
  model_name?: string;
  temperature?: number;
  max_tokens?: number,
  tools?: BindToolsInput[];
}

export function initChatModel(config: ChatModelConfig): BaseChatModel {
  let model: BaseChatModel;

  // remove unnecessary properties
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { model_provider, tools, ...llmConfig } = config;

  const llmConfigTs = {
    model: llmConfig.model_name,
    temperature: llmConfig.temperature,
    maxTokens: llmConfig.max_tokens,
  }

  try {
    switch (config.model_provider.toLowerCase()) {
      case 'openai':
        model = new ChatOpenAI(llmConfigTs);
        break;

      case 'anthropic':
        model = new ChatAnthropic(llmConfigTs);
        break;

      case 'groq':
        model = new ChatGroq(llmConfigTs);
        break;

      default:
        throw new Error(
          `Unsupported model_provider: ${config.model_provider}`,
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
        `Tool calling unsupported by model_provider: ${config.model_provider}`,
      );
    }

    return model;
  } catch (error) {
    throw new Error(`Failed to initialize chat model: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}
