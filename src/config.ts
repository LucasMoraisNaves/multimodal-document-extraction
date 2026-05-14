export const config = {
  apiKey: process.env.OPENROUTER_API_KEY!,
  httpReferer: '',
  xTitle: 'IA Devs',
  models: [
    // Modelo multimodal principal para análise documental.
    // Alternativas testadas/recomendadas:
    'google/gemini-3.1-flash-lite-preview',
    // 'openai/gpt-5-nano',
    // 'google/gemini-2.5-flash-lite-preview-09-2025',
    // 'google/gemini-2.5-flash-lite',
    // 'anthropic/claude-sonnet-4.5',
    // 'anthropic/claude-3.5-sonnet',
    // 'openai/gpt-4o',
    // 'google/gemini-pro-vision',
    // 'openai/gpt-5-image-mini',
  ],
  provider: {
    sort: {
      by: 'throughput',
      // Alternativas:
      // by: 'latency',
      // by: 'price',
      partition: 'none',
    },
  },
  temperature: 0,
};

export default config
