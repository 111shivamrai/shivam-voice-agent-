/**
 * Types, interfaces, and constants for ConversationModule.
 */

export type ConversationLanguage = 'hindi' | 'hinglish' | 'english';

export interface GenerateResponseDto {
  clientId: string;
  question: string;
  language?: ConversationLanguage | string;
}

export interface ConversationResponse {
  answer: string;
  source: 'document' | 'fallback';
  chunksUsed: number;
}

export interface RetrievedDocumentChunk {
  id?: string;
  filename?: string;
  original_filename?: string;
  chunk_index?: number;
  chunk_text: string;
  similarity: number;
  metadata?: Record<string, unknown>;
}

/**
 * Locked exact fallback responses.
 */
export const FALLBACK_RESPONSES = {
  hindi: 'इस बारे में मुझे अभी जानकारी नहीं है। मैं आपका नंबर ले सकता हूँ और हमारी टीम संपर्क करेगी।',
  english: "I don't have that information right now. Can I take your number so our team can get back to you?",
  hinglish: 'इस बारे में मुझे अभी जानकारी नहीं है। मैं आपका नंबर ले सकता हूँ और हमारी टीम संपर्क करेगी।',
} as const;

/**
 * Locked product constants for pgvector retrieval and OpenAI generation.
 */
export const SIMILARITY_THRESHOLD = 0.65;
export const MAX_CHUNKS_RETRIEVED = 5;
export const MAX_EMBEDDING_CACHE_SIZE = 100;
export const MAX_OUTPUT_TOKENS = 150;
export const GPT_TEMPERATURE = 0.3;
export const EMBEDDING_MODEL = 'text-embedding-3-small';
export const CHAT_MODEL = 'gpt-4o-mini';

/**
 * Normalizes input language string into supported ConversationLanguage.
 */
export function normalizeLanguage(lang?: string): ConversationLanguage {
  if (!lang || typeof lang !== 'string') {
    return 'english';
  }
  const lower = lang.toLowerCase().trim();
  if (lower === 'hindi' || lower.startsWith('hi')) {
    return 'hindi';
  }
  if (lower === 'hinglish') {
    return 'hinglish';
  }
  if (lower === 'english' || lower.startsWith('en')) {
    return 'english';
  }
  return 'english';
}

/**
 * Retrieves the exact locked fallback string for the specified language.
 */
export function getExactFallback(lang?: string): string {
  const normalized = normalizeLanguage(lang);
  return FALLBACK_RESPONSES[normalized];
}

/**
 * Truncates text to at most maxSentences (default 2), respecting both English (.!?)
 * and Devanagari (।) sentence boundary markers.
 */
export function enforceMaxSentences(text: string, maxSentences: number = 2): string {
  if (!text || !text.trim()) return '';

  const sentenceRegex = /[^.!?।॥\n]+(?:[.!?।॥]+|\n|$)/g;
  const matches = text.match(sentenceRegex);

  if (!matches || matches.length <= maxSentences) {
    return text.trim();
  }

  return matches.slice(0, maxSentences).join(' ').replace(/\s+/g, ' ').trim();
}
