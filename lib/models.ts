/**
 * Curated list of models available for debates.
 *
 * `id` must match a model id the Concentrate AI API exposes.
 * `supportsReasoning: true` increases the per-turn timeout/token budget.
 *
 * Add, remove, or reorder freely.
 */
import { ModelOption } from '@/lib/types';

export const MODELS: ModelOption[] = [
  // OpenAI
  { id: 'gpt-4o', name: 'GPT-4o', author: 'OpenAI', color: '#10a37f' },
  { id: 'gpt-4o-mini', name: 'GPT-4o Mini', author: 'OpenAI', color: '#10a37f' },
  { id: 'gpt-4.1', name: 'GPT-4.1', author: 'OpenAI', color: '#10a37f', supportsReasoning: true },
  { id: 'gpt-5', name: 'GPT-5', author: 'OpenAI', color: '#10a37f', supportsReasoning: true },
  { id: 'gpt-5-mini', name: 'GPT-5 Mini', author: 'OpenAI', color: '#10a37f' },

  // Anthropic
  { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5', author: 'Anthropic', color: '#d97757', supportsReasoning: true },
  { id: 'claude-sonnet-4', name: 'Claude Sonnet 4', author: 'Anthropic', color: '#d97757', supportsReasoning: true },
  { id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5', author: 'Anthropic', color: '#d97757', supportsReasoning: true },
  { id: 'claude-opus-4-5', name: 'Claude Opus 4.5', author: 'Anthropic', color: '#d97757', supportsReasoning: true },

  // Google
  { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', author: 'Google', color: '#4285F4', supportsReasoning: true },
  { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', author: 'Google', color: '#4285F4', supportsReasoning: true },

  // xAI
  { id: 'grok-4', name: 'Grok 4', author: 'xAI', color: '#000000', supportsReasoning: true },
  { id: 'grok-4-fast-reasoning', name: 'Grok 4 Fast', author: 'xAI', color: '#000000', supportsReasoning: true },

  // Mistral
  { id: 'mistral-medium', name: 'Mistral Medium', author: 'Mistral', color: '#5C549F' },
  { id: 'magistral-medium', name: 'Magistral Medium', author: 'Mistral', color: '#5C549F', supportsReasoning: true },

  // DeepSeek
  { id: 'deepseek-r1-distill-32b', name: 'DeepSeek R1', author: 'DeepSeek', color: '#4e9eff', supportsReasoning: true },

  // Meta
  { id: 'llama-3.3-70b-instruct', name: 'Llama 3.3 70B', author: 'Meta', color: '#0668E1' },
  { id: 'llama-4-scout', name: 'Llama 4 Scout', author: 'Meta', color: '#0668E1' },

  // Cohere
  { id: 'command-a', name: 'Command A', author: 'Cohere', color: '#39594D' },

  // Alibaba
  { id: 'qwen3-30b', name: 'Qwen3 30B', author: 'Alibaba', color: '#FF6A00', supportsReasoning: true },
];

export function getAllModels(): ModelOption[] {
  return MODELS;
}

export function findModelById(id: string): ModelOption | undefined {
  return MODELS.find((m) => m.id === id);
}

export function sortModelsByNaturalName(models: ModelOption[]): ModelOption[] {
  return models.slice().sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
}
