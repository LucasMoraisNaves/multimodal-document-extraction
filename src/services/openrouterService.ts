import { ChatOpenAI } from '@langchain/openai';
import { config } from '../config.ts';
import { SystemMessage, HumanMessage } from '@langchain/core/messages';

export type LLMResponse = {
  model: string;
  content: string;
  usage: UsageInfo;
};

export type UsageInfo = {
  model: string;
  input_tokens: number | null;
  output_tokens: number | null;
  total_tokens: number | null;
  cost: number | null;
  currency: 'USD';
  source: 'openrouter';
};

export type DocumentForGeneration = {
  inputKind: 'pdf' | 'image' | 'spreadsheet';
  mimeType: string;
  base64?: string;
  content?: string;
};

export class OpenRouterService {
  private llmClient: ChatOpenAI;

  constructor() {
    this.llmClient = new ChatOpenAI({
      apiKey: config.apiKey,
      modelName: config.models[0],
      temperature: config.temperature,
      configuration: {
        baseURL: 'https://openrouter.ai/api/v1',
        defaultHeaders: {
          'HTTP-Referer': config.httpReferer,
          'X-Title': config.xTitle,
        },
      },

      // Envia o roteamento de provedor e a lista de modelos para o OpenRouter
      modelKwargs: {
        models: config.models,
        provider: config.provider,
      },
    });
  }

  async generateWithDocument(
    systemPrompt: string,
    userPrompt: string,
    document: DocumentForGeneration,
  ): Promise<LLMResponse> {
    try {
      const content = buildHumanMessageContent(userPrompt, document);

      const messages = [
        new SystemMessage(systemPrompt),
        new HumanMessage({
          content,
        }),
      ];

      const response = await this.llmClient.invoke(messages);
      logOpenRouterMetadata(response);

      return {
        model: response.response_metadata?.model_name || config.models[0],
        content: response.content.toString(),
        usage: extractUsage(response),
      };
    } catch (error) {
      throw new Error(`Falha na geração multimodal: ${error instanceof Error ? error.message : 'Erro desconhecido'}`);
    }
  }
}

function extractUsage(response: unknown): UsageInfo {
  const responseRecord = asRecord(response);
  const responseMetadata = asRecord(responseRecord.response_metadata);
  const usageMetadata = asRecord(responseRecord.usage_metadata);
  const additionalKwargs = asRecord(responseRecord.additional_kwargs);
  const raw = asOptionalRecord(responseMetadata.raw) || asOptionalRecord(additionalKwargs.raw) || {};
  const tokenUsage = asOptionalRecord(responseMetadata.tokenUsage)
    || asOptionalRecord(responseMetadata.token_usage)
    || asOptionalRecord(additionalKwargs.tokenUsage)
    || asOptionalRecord(additionalKwargs.token_usage)
    || {};
  const usage = asOptionalRecord(responseMetadata.usage)
    || asOptionalRecord(responseMetadata.usage_metadata)
    || asOptionalRecord(additionalKwargs.usage)
    || asOptionalRecord(raw.usage)
    || {};

  const model = getString(responseMetadata.model_name)
    || getString(responseMetadata.model)
    || config.models[0];

  const inputTokens = getNumber(
    usageMetadata.input_tokens,
    usageMetadata.inputTokens,
    tokenUsage?.promptTokens,
    tokenUsage?.prompt_tokens,
    usage?.prompt_tokens,
    usage?.input_tokens,
    usage?.inputTokens,
  );

  const outputTokens = getNumber(
    usageMetadata.output_tokens,
    usageMetadata.outputTokens,
    tokenUsage?.completionTokens,
    tokenUsage?.completion_tokens,
    usage?.completion_tokens,
    usage?.output_tokens,
    usage?.outputTokens,
  );

  const totalTokens = getNumber(
    usageMetadata.total_tokens,
    usageMetadata.totalTokens,
    tokenUsage?.totalTokens,
    tokenUsage?.total_tokens,
    usage?.total_tokens,
    usage?.totalTokens,
  );

  const cost = getNumber(
    responseMetadata.cost,
    responseMetadata.total_cost,
    responseMetadata.totalCost,
    responseMetadata.estimated_cost,
    responseMetadata.estimatedCost,
    usageMetadata.cost,
    usageMetadata.total_cost,
    usageMetadata.totalCost,
    usage?.cost,
    usage?.total_cost,
    usage?.totalCost,
    usage?.estimated_cost,
    usage?.estimatedCost,
    additionalKwargs.cost,
    additionalKwargs.total_cost,
    additionalKwargs.totalCost,
    additionalKwargs.estimated_cost,
    additionalKwargs.estimatedCost,
    raw.cost,
    raw.total_cost,
    raw.totalCost,
    raw.estimated_cost,
    raw.estimatedCost,
  );

  return {
    model,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_tokens: totalTokens,
    cost,
    currency: 'USD',
    source: 'openrouter',
  };
}

function logOpenRouterMetadata(response: unknown): void {
  if (process.env.DEBUG_OPENROUTER_METADATA !== 'true') {
    return;
  }

  const responseRecord = asRecord(response);
  console.log('[openrouter:metadata]', JSON.stringify({
    response_metadata: responseRecord.response_metadata ?? null,
    usage_metadata: responseRecord.usage_metadata ?? null,
    additional_kwargs: responseRecord.additional_kwargs ?? null,
    lc_kwargs: responseRecord.lc_kwargs ?? null,
  }, null, 2));
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};
}

function asOptionalRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : undefined;
}

function getNumber(...values: unknown[]): number | null {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }

    if (typeof value === 'string' && value.trim() !== '') {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }

  return null;
}

function getString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function buildHumanMessageContent(
  userPrompt: string,
  document: DocumentForGeneration,
) {
  const textContent = document.content
    ? `${userPrompt}\n\nConteúdo textual/estruturado extraído do documento:\n${document.content}`
    : userPrompt;

  const content: Array<
    | { type: 'text'; text: string }
    | { type: 'image_url'; image_url: { url: string } }
  > = [
    {
      type: 'text',
      text: textContent,
    },
  ];

  if (document.inputKind === 'spreadsheet') {
    return content;
  }

  if (!document.base64) {
    throw new Error('Documento em base64 não foi informado para entrada multimodal');
  }

  content.push({
    type: 'image_url',
    image_url: {
      url: `data:${document.mimeType};base64,${document.base64}`,
    },
  });

  return content;
}
