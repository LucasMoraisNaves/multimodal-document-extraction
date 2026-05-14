import { config } from './config.ts';
import type { UsageInfo } from './services/openrouterService.ts';

export type ExtractResponse = {
  data: Record<string, unknown>;
  analysis: {
    document_type_detected: string | null;
    visual_description: string | null;
    warnings: string[];
  };
  confidence: {
    overall: number | string | null;
    fields: Record<string, unknown>;
  };
  usage: UsageInfo;
};

const defaultUsage: UsageInfo = {
  model: config.models[0],
  input_tokens: null,
  output_tokens: null,
  total_tokens: null,
  cost: null,
  currency: 'USD',
  source: 'openrouter',
};

export function formatModelResponse(
  modelResponse: string,
  usage?: UsageInfo,
): ExtractResponse {
  const parsed = parseJsonObject(modelResponse);

  if (!parsed) {
    return {
      data: {
        raw_response: modelResponse,
      },
      analysis: {
        document_type_detected: null,
        visual_description: null,
        warnings: ['MODEL_RESPONSE_NOT_STRUCTURED_AS_JSON'],
      },
      confidence: {
        overall: null,
        fields: {},
      },
      usage: usage ?? defaultUsage,
    };
  }

  return {
    data: asRecord(parsed.data),
    analysis: {
      document_type_detected: getNullableString(asRecord(parsed.analysis).document_type_detected),
      visual_description: getNullableString(asRecord(parsed.analysis).visual_description),
      warnings: getStringArray(asRecord(parsed.analysis).warnings),
    },
    confidence: {
      overall: getConfidenceValue(asRecord(parsed.confidence).overall),
      fields: asRecord(asRecord(parsed.confidence).fields),
    },
    usage: usage ?? defaultUsage,
  };
}

function parseJsonObject(value: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(value);
    return asOptionalRecord(parsed);
  } catch {
    return undefined;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return asOptionalRecord(value) ?? {};
}

function asOptionalRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function getNullableString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function getStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function getConfidenceValue(value: unknown): number | string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim()) {
    return value;
  }

  return null;
}
