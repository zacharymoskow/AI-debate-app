export type DebateMode = 'balanced' | 'skeptical' | 'creative';
export type DebateRole = 'starter' | 'challenge' | 'add_on' | 'red_team';

export interface DebateThreadMessage {
  id: string;
  threadId: string;
  modelId: string | null;
  isUser: boolean;
  text: string;
  order: number;
  createdAt: string;
}

export interface DebateThread {
  id: string;
  sessionId: string;
  parentMessageId: string;
  createdAt: string;
  updatedAt: string;
  messages: DebateThreadMessage[];
}

export interface DebateMessage {
  id: string;
  sessionId: string;
  modelId: string | null;
  role: DebateRole;
  text: string;
  order: number;
  createdAt: string;
  threads: DebateThread[];
  status?: 'ok' | 'error';
}

export interface DebateSession {
  id: string;
  title: string;
  question: string;
  context: string | null;
  mode: DebateMode;
  selectedModels: string[];
  summary: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
  messages: DebateMessage[];
  threads: DebateThread[];
}

export interface CreateDebateRequest {
  question: string;
  context?: string;
  mode: DebateMode;
  modelIds: string[];
}

export const DEBATE_ROLE_LABELS: Record<DebateRole, string> = {
  starter: 'opens',
  challenge: 'challenges',
  add_on: 'adds on',
  red_team: 'red-teams',
};

export const DEBATE_MODES: Array<{ id: DebateMode; label: string; description: string }> = [
  {
    id: 'balanced',
    label: 'Balanced',
    description: 'Direct, practical disagreement without theatrics.',
  },
  {
    id: 'skeptical',
    label: 'Skeptical',
    description: 'Push harder on assumptions and weak proof.',
  },
  {
    id: 'creative',
    label: 'Creative',
    description: 'Look for reframes, angles, and missing possibilities.',
  },
];

export function isDebateMode(value: unknown): value is DebateMode {
  return value === 'balanced' || value === 'skeptical' || value === 'creative';
}

export function getNextDebateRole(index: number): DebateRole {
  const roles: DebateRole[] = ['challenge', 'add_on', 'red_team'];
  return roles[(index - 1) % roles.length];
}

export function buildDebateTitle(question: string): string {
  const trimmed = question.trim().replace(/\s+/g, ' ');
  if (trimmed.length <= 54) return trimmed;
  return `${trimmed.slice(0, 51).trim()}...`;
}

export const MAX_DEBATE_ROUNDS = 3;

export function clampRounds(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed)) return 1;
  return Math.min(Math.max(Math.floor(parsed), 1), MAX_DEBATE_ROUNDS);
}

export function shuffleArray<T>(items: readonly T[]): T[] {
  const result = items.slice();
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export interface DebateTurnTranscript {
  speakerName: string;
  role: DebateRole;
  text: string;
}

const HARD_LENGTH_RULES = [
  'HARD RULES:',
  '- Reply in 1 to 3 sentences. Vary the length naturally — sometimes a single sharp sentence, sometimes three.',
  '- Plain prose only. No markdown, no bold, no italics, no headers, no bullet lists, no numbered lists, no tables.',
  '- No preamble like "Position:" or "8/10 because". Just speak.',
  '- No hedging filler like "It depends" or "On the one hand".',
  '- Refer to other models by name when responding to them (e.g., "GPT-4o is right that..." or "Claude Sonnet 4, that misses..."). Do not say "the previous response" or "the previous model".',
  '- Never refer to yourself in the third person.',
  '- Only react to the speakers shown in the transcript. Never mention missing turns, "could not respond", "no response", system errors, technical issues, or any model that is not in the transcript. If you can think of an objection but the target speaker is not present, redirect it at someone who is.',
  '- Take a position on the question itself. Do not refuse to participate, do not say you cannot disagree, and do not flag the conversation as broken.',
].join('\n');

function formatTranscript(turns: readonly DebateTurnTranscript[]): string {
  return turns.map((turn) => `${turn.speakerName} (${turn.role}): ${turn.text}`).join('\n');
}

function formatOtherVoices(otherNames: readonly string[]): string {
  if (otherNames.length === 0) return 'none yet';
  return otherNames.join(', ');
}

export function buildStarterPrompt({
  selfName,
  otherNames,
  question,
  context,
  mode,
}: {
  selfName: string;
  otherNames: readonly string[];
  question: string;
  context?: string;
  mode: DebateMode;
}): string {
  return [
    `You are speaking as ${selfName} in a multi-model group chat debate.`,
    `Other voices in this chat: ${formatOtherVoices(otherNames)}.`,
    'You open the debate. Take a clear stance and stake it. Speak in first person.',
    `Tone: ${mode}.`,
    HARD_LENGTH_RULES,
    context?.trim() ? `Context: ${context.trim()}` : '',
    `Question: ${question.trim()}`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

export function buildFollowupPrompt({
  selfName,
  otherNames,
  question,
  context,
  previousTurns,
  role,
  mode,
}: {
  selfName: string;
  otherNames: readonly string[];
  question: string;
  context?: string;
  previousTurns: readonly DebateTurnTranscript[];
  role: DebateRole;
  mode: DebateMode;
}): string {
  const roleInstruction: Record<Exclude<DebateRole, 'starter'>, string> = {
    challenge: 'Disagree with the most recent speaker. Name the single weakest point in their take in one sharp sentence, then offer a better framing. Address them by name.',
    add_on: 'Build on what someone said. Pick one specific point from a prior speaker, name them, and add what is missing. Do not simply agree.',
    red_team: 'Red-team the strongest take so far. Name whose argument you are pressuring, point out the failure mode it ignores, and say what would change your mind.',
  };

  const lastSpeaker = previousTurns[previousTurns.length - 1];
  const lastSpeakerHint = lastSpeaker
    ? `The most recent speaker was ${lastSpeaker.speakerName}. Address them directly by name where it makes sense.`
    : '';

  return [
    `You are speaking as ${selfName} in a multi-model group chat debate.`,
    `Other voices in this chat: ${formatOtherVoices(otherNames)}.`,
    `Tone: ${mode}.`,
    role === 'starter' ? '' : roleInstruction[role],
    lastSpeakerHint,
    HARD_LENGTH_RULES,
    context?.trim() ? `Context: ${context.trim()}` : '',
    `Question: ${question.trim()}`,
    `So far:\n${formatTranscript(previousTurns)}`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

export function buildSummaryPrompt({
  question,
  messages,
}: {
  question: string;
  messages: readonly DebateTurnTranscript[];
}): string {
  return [
    'Recap this multi-model debate in 1-2 sentences. Plain prose, no markdown, no bold, no headers, no lists.',
    'You MUST name at least one specific model from the debate (use their display name exactly as written in the transcript, e.g., "GPT-4o", "Claude Sonnet 4", "Gemini 2.5 Flash"). Quote no one verbatim.',
    'Focus on the single sharpest disagreement or the most useful takeaway. Do not list every model and do not summarize each turn one by one.',
    'Skip any speaker whose turn was missing or unavailable.',
    `Question: ${question.trim()}`,
    `Debate:\n${formatTranscript(messages)}`,
  ].join('\n\n');
}

export function buildThreadPrompt({
  parentSpeakerName,
  parentText,
  userReply,
  selfName,
}: {
  parentSpeakerName: string;
  parentText: string;
  userReply: string;
  selfName: string;
}): string {
  return [
    `You are speaking as ${selfName} in a side thread attached to a debate message from ${parentSpeakerName}.`,
    `${parentSpeakerName} said: ${parentText}`,
    `User said: ${userReply}`,
    `Reply directly. Refer to ${parentSpeakerName} by name when responding to their take.`,
    'HARD RULES: 1-3 sentences. Plain prose. No markdown, no bold, no headers, no lists. Never say "the previous model".',
  ].join('\n\n');
}
