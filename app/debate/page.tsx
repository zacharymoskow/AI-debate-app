'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowUp, ArrowUpRight, AtSign, Bookmark, ChevronDown, ChevronUp, Loader2, Mic, Plus, Search, X } from 'lucide-react';
import { DebateMessage, DebateMode, DebateSession, DebateThread, DEBATE_MODES, DEBATE_ROLE_LABELS, MAX_DEBATE_ROUNDS } from '@/lib/debate';
import { getAllModels, sortModelsByNaturalName } from '@/lib/models';
import { ModelOption } from '@/lib/types';
import { ModelIcon } from '@/components/ModelIcon';

const DEFAULT_MODELS = ['gpt-4o', 'claude-sonnet-4', 'gemini-2.5-flash'];

function formatTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
}

function formatRelativeTime(value: string, now: number = Date.now()): string {
  const ms = now - new Date(value).getTime();
  const sec = Math.max(0, Math.round(ms / 1000));
  if (sec < 60) return `${sec} sec`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} min`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} hr`;
  const day = Math.round(hr / 24);
  return `${day} d`;
}

function lowercaseModelName(name: string): string {
  return name.toLowerCase();
}

function getModelName(models: ModelOption[], modelId: string | null): string {
  if (!modelId) return 'You';
  return models.find((model) => model.id === modelId)?.name || modelId;
}

function getModel(models: ModelOption[], modelId: string | null): ModelOption | undefined {
  if (!modelId) return undefined;
  return models.find((model) => model.id === modelId);
}

function mergeThreadIntoSession(session: DebateSession, thread: DebateThread): DebateSession {
  return {
    ...session,
    threads: [thread, ...session.threads.filter((item) => item.id !== thread.id)],
    messages: session.messages.map((message) => {
      if (message.id !== thread.parentMessageId) return message;
      return {
        ...message,
        threads: [thread, ...message.threads.filter((item) => item.id !== thread.id)],
      };
    }),
  };
}

async function readJsonResponse(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export default function DebatePage() {
  const [models, setModels] = useState<ModelOption[]>(() => sortModelsByNaturalName(getAllModels()));
  const [selectedModelIds, setSelectedModelIds] = useState<string[]>(DEFAULT_MODELS);
  const [question, setQuestion] = useState('evaluate this positioning: "ai-native design studio. we design how ai changes people and products." score 0-10.');
  const [mode, setMode] = useState<DebateMode>('balanced');
  const [sessions, setSessions] = useState<DebateSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [activeThreadMessageId, setActiveThreadMessageId] = useState<string | null>(null);
  const [threadReply, setThreadReply] = useState('');
  const [modelSearch, setModelSearch] = useState('');
  const [isModelPickerOpen, setIsModelPickerOpen] = useState(false);
  const [isLoadingDebates, setIsLoadingDebates] = useState(true);
  const [isStarting, setIsStarting] = useState(false);
  const [isThreadSending, setIsThreadSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [collapsedMessages, setCollapsedMessages] = useState<Set<string>>(new Set());
  const [rounds, setRounds] = useState<number>(1);
  const [confirmDelete, setConfirmDelete] = useState<{ kind: 'one'; id: string; title: string } | { kind: 'all' } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isRecentCollapsed, setIsRecentCollapsed] = useState(false);

  function toggleMessageCollapsed(messageId: string) {
    setCollapsedMessages((current) => {
      const next = new Set(current);
      if (next.has(messageId)) next.delete(messageId);
      else next.add(messageId);
      return next;
    });
  }

  const activeSession = useMemo(
    () => (activeSessionId ? sessions.find((session) => session.id === activeSessionId) : undefined),
    [activeSessionId, sessions]
  );
  const activeThreadMessage = activeSession?.messages.find((message) => message.id === activeThreadMessageId) || null;
  const filteredModels = useMemo(() => {
    const query = modelSearch.trim().toLowerCase();
    return models
      .filter((model) => {
        if (!query) return true;
        return `${model.name} ${model.author}`.toLowerCase().includes(query);
      })
      .slice(0, 40);
  }, [modelSearch, models]);
  const selectedModels = selectedModelIds
    .map((modelId) => getModel(models, modelId))
    .filter((model): model is ModelOption => Boolean(model));

  useEffect(() => {
    const nextModels = sortModelsByNaturalName(getAllModels());
    setModels(nextModels);
    setSelectedModelIds((current) => {
      const available = new Set(nextModels.map((model) => model.id));
      const valid = current.filter((modelId) => available.has(modelId));
      if (valid.length >= 2) return valid;
      return DEFAULT_MODELS.filter((modelId) => available.has(modelId)).slice(0, 3);
    });
  }, []);

  useEffect(() => {
    let active = true;
    async function loadDebates() {
      setIsLoadingDebates(true);
      try {
        const response = await fetch('/api/debates');
        if (!response.ok) {
          throw new Error('Could not load saved debates.');
        }
        const data = (await response.json()) as DebateSession[];
        if (!active) return;
        setSessions(data);
        setActiveSessionId(data[0]?.id || null);
      } catch (loadError) {
        if (!active) return;
        setError(loadError instanceof Error ? loadError.message : 'Could not load saved debates.');
      } finally {
        if (active) setIsLoadingDebates(false);
      }
    }

    loadDebates();
    return () => {
      active = false;
    };
  }, []);

  function toggleModel(modelId: string) {
    setSelectedModelIds((current) => {
      if (current.includes(modelId)) {
        return current.filter((id) => id !== modelId);
      }
      if (current.length >= 5) return current;
      return [...current, modelId];
    });
  }

  async function startDebate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (selectedModelIds.length < 2) {
      setError('Select at least two models.');
      return;
    }
    if (!question.trim()) {
      setError('Enter a question to debate.');
      return;
    }

    setIsStarting(true);
    try {
      const response = await fetch('/api/debates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question,
          mode,
          modelIds: selectedModelIds,
          rounds,
        }),
      });

      if (!response.ok) {
        const data = await readJsonResponse(response);
        const message =
          data && typeof data === 'object' && 'error' in data && typeof data.error === 'string'
            ? data.error
            : 'Could not start the debate.';
        throw new Error(message);
      }

      if (!response.body) {
        throw new Error('Streaming is not supported in this browser.');
      }

      let activeStreamSessionId: string | null = null;
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          let event: { type?: string; [key: string]: unknown };
          try {
            event = JSON.parse(trimmed);
          } catch {
            console.warn('[Debate] Skipping malformed stream line', { line: trimmed.slice(0, 200) });
            continue;
          }

          if (event.type === 'session') {
            const session = event.session as DebateSession;
            activeStreamSessionId = session.id;
            setSessions((current) => [session, ...current.filter((item) => item.id !== session.id)]);
            setActiveSessionId(session.id);
            setActiveThreadMessageId(null);
          } else if (event.type === 'message' && activeStreamSessionId) {
            const incoming = event.message as DebateMessage;
            const targetId = activeStreamSessionId;
            setSessions((current) =>
              current.map((session) =>
                session.id === targetId
                  ? {
                      ...session,
                      messages: [
                        ...session.messages.filter((message) => message.id !== incoming.id),
                        incoming,
                      ].sort((a, b) => a.order - b.order),
                    }
                  : session
              )
            );
          } else if (event.type === 'done' && activeStreamSessionId) {
            const summary = typeof event.summary === 'string' ? event.summary : '';
            const targetId = activeStreamSessionId;
            setSessions((current) =>
              current.map((session) =>
                session.id === targetId
                  ? { ...session, summary, status: 'completed' }
                  : session
              )
            );
          } else if (event.type === 'error') {
            const message = typeof event.error === 'string' ? event.error : 'The debate stream failed.';
            setError(message);
          }
        }
      }
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : 'Could not start the debate.');
    } finally {
      setIsStarting(false);
    }
  }

  async function deleteOne(id: string) {
    setIsDeleting(true);
    setError(null);
    try {
      const response = await fetch(`/api/debates/${id}`, { method: 'DELETE' });
      if (!response.ok) {
        const data = await readJsonResponse(response);
        const message =
          data && typeof data === 'object' && 'error' in data && typeof data.error === 'string'
            ? data.error
            : 'Could not delete debate.';
        throw new Error(message);
      }
      setSessions((current) => current.filter((session) => session.id !== id));
      setActiveSessionId((current) => {
        if (current !== id) return current;
        const remaining = sessions.filter((session) => session.id !== id);
        return remaining[0]?.id || null;
      });
      setActiveThreadMessageId(null);
      setConfirmDelete(null);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Could not delete debate.');
    } finally {
      setIsDeleting(false);
    }
  }

  async function deleteAll() {
    setIsDeleting(true);
    setError(null);
    try {
      const response = await fetch('/api/debates', { method: 'DELETE' });
      if (!response.ok) {
        const data = await readJsonResponse(response);
        const message =
          data && typeof data === 'object' && 'error' in data && typeof data.error === 'string'
            ? data.error
            : 'Could not clear debates.';
        throw new Error(message);
      }
      setSessions([]);
      setActiveSessionId(null);
      setActiveThreadMessageId(null);
      setConfirmDelete(null);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Could not clear debates.');
    } finally {
      setIsDeleting(false);
    }
  }

  async function sendThreadReply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeSession || !activeThreadMessage || !threadReply.trim()) return;

    setIsThreadSending(true);
    setError(null);
    try {
      const response = await fetch(`/api/debates/${activeSession.id}/threads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          parentMessageId: activeThreadMessage.id,
          text: threadReply,
        }),
      });
      const data = await readJsonResponse(response);
      if (!response.ok) {
        const message =
          data && typeof data === 'object' && 'error' in data && typeof data.error === 'string'
            ? data.error
            : 'Could not update the thread.';
        throw new Error(message);
      }
      const thread = data as DebateThread;
      setSessions((current) =>
        current.map((session) => (session.id === activeSession.id ? mergeThreadIntoSession(session, thread) : session))
      );
      setThreadReply('');
    } catch (threadError) {
      setError(threadError instanceof Error ? threadError.message : 'Could not update the thread.');
    } finally {
      setIsThreadSending(false);
    }
  }

  return (
    <main className="h-screen overflow-hidden bg-gray-50 text-gray-900 dark:bg-concentrate-black dark:text-white">
      <div className="mx-auto grid h-full w-full max-w-7xl gap-4 px-4 py-3 lg:grid-cols-[240px_minmax(0,1fr)_320px]">
        <aside className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-950">
          <div className="flex flex-shrink-0 items-start justify-between gap-3 px-4 pt-4 pb-3">
            <div className="min-w-0">
              <h1 className="text-base font-semibold tracking-tight text-gray-900 dark:text-white">Debate</h1>
              <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">Ask once. Let the models push each other.</p>
            </div>
            <button
              type="button"
              onClick={() => setActiveSessionId(null)}
              className="flex-shrink-0 rounded-full border border-gray-200 p-1.5 text-gray-500 transition-colors hover:bg-gray-100 dark:border-gray-800 dark:text-gray-400 dark:hover:bg-gray-900"
              aria-label="New debate"
              title="New debate"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className={`flex ${isRecentCollapsed ? 'flex-shrink-0' : 'flex-1 min-h-0'} flex-col border-t border-gray-200 dark:border-gray-800`}>
            <div className="flex flex-shrink-0 items-center justify-between px-4 pt-3 pb-2">
              <button
                type="button"
                onClick={() => setIsRecentCollapsed((value) => !value)}
                className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-gray-500 transition-colors hover:text-gray-900 dark:text-gray-500 dark:hover:text-white"
                aria-expanded={!isRecentCollapsed}
              >
                {isRecentCollapsed ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />}
                Recent debates
                {sessions.length > 0 && (
                  <span className="text-gray-400 dark:text-gray-600">· {sessions.length}</span>
                )}
              </button>
              {sessions.length > 0 && !isRecentCollapsed && (
                <button
                  type="button"
                  onClick={() => setConfirmDelete({ kind: 'all' })}
                  className="text-[10px] font-medium uppercase tracking-wide text-gray-500 transition-colors hover:text-red-600 dark:text-gray-500 dark:hover:text-red-400"
                >
                  Clear
                </button>
              )}
            </div>
            {!isRecentCollapsed && (
              <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-4">
                <div className="space-y-1.5">
                  {isLoadingDebates && <p className="text-xs text-gray-500 dark:text-gray-400">Loading saved debates...</p>}
                  {!isLoadingDebates && sessions.length === 0 && (
                    <p className="text-xs text-gray-500 dark:text-gray-400">No saved debates yet.</p>
                  )}
                  {sessions.map((session) => (
                    <div
                      key={session.id}
                      className={`group relative rounded-lg border transition-colors ${
                        activeSession?.id === session.id
                          ? 'border-[#3D9970] bg-[#3D9970]/10'
                          : 'border-gray-200 hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-900'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setActiveSessionId(session.id);
                          setActiveThreadMessageId(null);
                        }}
                        className="w-full px-2.5 py-1.5 pr-7 text-left"
                      >
                        <span className="line-clamp-2 text-[12px] font-medium text-gray-900 dark:text-white">{session.title}</span>
                        <span className="mt-0.5 block text-[10px] text-gray-500 dark:text-gray-400">
                          {session.selectedModels.length} models · {formatTime(session.createdAt)}
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDelete({ kind: 'one', id: session.id, title: session.title })}
                        aria-label="Delete debate"
                        className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded text-gray-400 opacity-0 transition-all hover:bg-gray-200 hover:text-red-600 group-hover:opacity-100 focus:opacity-100 dark:hover:bg-gray-800 dark:hover:text-red-400"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </aside>

        <section className="flex h-full min-h-0 flex-col items-center justify-center px-2">
          {/* iPhone-style frame */}
          <div className="relative mx-auto flex h-full min-h-0 w-full max-w-[420px] flex-col">
            {/* side buttons */}
            <span aria-hidden className="pointer-events-none absolute -left-[3px] top-[110px] h-9 w-[3px] rounded-l-sm bg-black/70" />
            <span aria-hidden className="pointer-events-none absolute -left-[3px] top-[160px] h-14 w-[3px] rounded-l-sm bg-black/70" />
            <span aria-hidden className="pointer-events-none absolute -left-[3px] top-[220px] h-14 w-[3px] rounded-l-sm bg-black/70" />
            <span aria-hidden className="pointer-events-none absolute -right-[3px] top-[180px] h-20 w-[3px] rounded-r-sm bg-black/70" />

            {/* outer bezel */}
            <div className="relative flex h-full min-h-0 flex-col rounded-[3rem] bg-[#0b0b0d] p-[10px] shadow-[0_30px_70px_-20px_rgba(0,0,0,0.6),inset_0_0_0_1px_rgba(255,255,255,0.06)]">
              {/* inner screen */}
              <div className="relative flex h-full min-h-0 flex-col overflow-hidden rounded-[2.4rem] bg-[#d8d6c8] dark:bg-[#1f1f1d]">
                {/* status bar / dynamic island */}
                <div className="relative flex h-7 flex-shrink-0 items-center justify-center">
                  <span aria-hidden className="absolute left-1/2 top-1.5 h-5 w-24 -translate-x-1/2 rounded-full bg-black/85" />
                </div>

                {activeSession ? (
                  <>
                    {/* header — You + bookmark + threads */}
                    <div className="flex flex-shrink-0 items-start justify-between gap-3 px-5 pt-1 pb-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <img
                            src="/avatar.svg"
                            alt="You"
                            className="h-6 w-6 flex-shrink-0 rounded-full object-cover ring-1 ring-black/10 dark:ring-white/10"
                          />
                          <span className="text-xs font-medium tracking-wide text-gray-600 dark:text-gray-400">
                            You
                          </span>
                        </div>
                        <h2 className="mt-2 line-clamp-3 text-[15px] font-medium leading-snug text-gray-950 dark:text-white">
                          {activeSession.question}
                        </h2>
                      </div>
                      <div className="flex flex-shrink-0 items-center gap-2">
                        <button
                          type="button"
                          aria-label="Bookmark"
                          className="flex h-8 w-8 items-center justify-center rounded-full bg-white/70 text-gray-700 transition-colors hover:bg-white dark:bg-gray-900/70 dark:text-gray-300"
                        >
                          <Bookmark className="h-3.5 w-3.5" />
                        </button>
                        <span className="rounded-full bg-white/80 px-3.5 py-1.5 text-xs font-medium text-gray-800 dark:bg-gray-900/80 dark:text-gray-200">
                          threads
                        </span>
                      </div>
                    </div>

                    {/* messages — only scroll target */}
                    <div className="flex-1 min-h-0 space-y-5 overflow-y-auto px-5 py-3">
                      {activeSession.messages.map((message) => (
                        <DebateBubble
                          key={message.id}
                          message={message}
                          models={models}
                          isActive={activeThreadMessageId === message.id}
                          isCollapsed={collapsedMessages.has(message.id)}
                          onToggleCollapsed={() => toggleMessageCollapsed(message.id)}
                          onOpenThread={() => setActiveThreadMessageId(message.id)}
                        />
                      ))}
                      {isStarting && (
                        <div className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          <span>next model is thinking...</span>
                        </div>
                      )}

                      {/* summary bubble — appears at bottom of conversation, scrolls with messages */}
                      {(activeSession.summary || isStarting) && (
                        <div className="flex items-start gap-2 rounded-2xl bg-white/55 px-3 py-2.5 dark:bg-gray-900/60">
                          <span className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-white/80 text-gray-700 dark:bg-gray-950/80 dark:text-gray-300">
                            <AtSign className="h-3 w-3" />
                          </span>
                          <p className="text-[13px] leading-snug text-gray-800 dark:text-gray-200">
                            {activeSession.summary
                              ? activeSession.summary
                              : 'recap arrives once the models finish...'}
                          </p>
                        </div>
                      )}
                    </div>

                    {/* iMessage-style composer */}
                    <div className="flex flex-shrink-0 items-center gap-2 border-t border-black/5 bg-black/10 px-3 py-3 dark:border-white/10 dark:bg-black/30">
                      <button
                        type="button"
                        aria-label="Voice"
                        className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-white/80 text-gray-700 transition-colors hover:bg-white dark:bg-gray-900/80 dark:text-gray-300"
                      >
                        <Mic className="h-3.5 w-3.5" />
                      </button>
                      <div className="min-w-0 flex-1 rounded-full bg-white/85 px-3.5 py-1.5 text-sm text-gray-500 dark:bg-gray-900/85 dark:text-gray-500">
                        Reply
                      </div>
                      <button
                        type="button"
                        aria-label="Mention"
                        className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-white/80 text-gray-700 transition-colors hover:bg-white dark:bg-gray-900/80 dark:text-gray-300"
                      >
                        <AtSign className="h-3.5 w-3.5" />
                      </button>
                      <span className="flex-shrink-0 rounded-full bg-white/85 px-3.5 py-1.5 text-xs font-medium text-gray-800 dark:bg-gray-900/85 dark:text-gray-200">
                        summary
                      </span>
                      <button
                        type="button"
                        aria-label="More"
                        className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-white/80 text-gray-700 transition-colors hover:bg-white dark:bg-gray-900/80 dark:text-gray-300"
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </button>
                    </div>

                    {/* home indicator */}
                    <div className="flex h-5 flex-shrink-0 items-center justify-center bg-[#d8d6c8] dark:bg-[#1f1f1d]">
                      <span aria-hidden className="h-1 w-28 rounded-full bg-black/70 dark:bg-white/40" />
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex flex-shrink-0 items-start justify-between gap-3 px-5 pt-1 pb-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <img
                            src="/avatar.svg"
                            alt="You"
                            className="h-6 w-6 flex-shrink-0 rounded-full object-cover ring-1 ring-black/10 dark:ring-white/10"
                          />
                          <span className="text-xs font-medium tracking-wide text-gray-600 dark:text-gray-400">
                            You
                          </span>
                        </div>
                        <h2 className="mt-2 text-[15px] font-medium leading-snug text-gray-950 dark:text-white">
                          Start a debate
                        </h2>
                      </div>
                      <span className="rounded-full bg-white/80 px-3.5 py-1.5 text-xs font-medium text-gray-800 dark:bg-gray-900/80 dark:text-gray-200">
                        new
                      </span>
                    </div>

                    <form
                      onSubmit={startDebate}
                      className="flex flex-1 min-h-0 flex-col"
                    >
                      <div className="flex-1 min-h-0 space-y-4 overflow-y-auto px-5 pt-2 pb-4">
                        <textarea
                          value={question}
                          onChange={(event) => setQuestion(event.target.value)}
                          rows={5}
                          className="w-full rounded-2xl bg-white/85 px-4 py-3 text-[15px] leading-snug text-gray-950 outline-none transition-colors placeholder:text-gray-400 focus:bg-white dark:bg-gray-900/80 dark:text-white dark:placeholder:text-gray-500 dark:focus:bg-gray-900"
                          style={{ resize: 'vertical', minHeight: '8.5rem', maxHeight: '24rem' }}
                          placeholder="Ask anything. Add background, constraints, or examples — give the models the full picture."
                        />

                        <div className="space-y-2">
                          <span className="block px-1 text-[10px] font-medium uppercase tracking-wider text-gray-600 dark:text-gray-400">
                            Mode
                          </span>
                          <div className="grid grid-cols-3 gap-1.5">
                            {DEBATE_MODES.map((item) => (
                              <button
                                key={item.id}
                                type="button"
                                onClick={() => setMode(item.id)}
                                title={item.description}
                                className={`rounded-full px-3 py-1.5 text-[12px] font-medium transition-colors ${
                                  mode === item.id
                                    ? 'bg-gray-950 text-white shadow-sm dark:bg-white dark:text-gray-950'
                                    : 'bg-white/70 text-gray-700 hover:bg-white dark:bg-gray-900/70 dark:text-gray-300 dark:hover:bg-gray-900'
                                }`}
                              >
                                {item.label}
                              </button>
                            ))}
                          </div>
                        </div>

                        <div className="space-y-2">
                          <div className="flex items-center justify-between px-1">
                            <span className="text-[10px] font-medium uppercase tracking-wider text-gray-600 dark:text-gray-400">
                              Rounds
                            </span>
                            <span className="text-[10px] text-gray-600 dark:text-gray-400">
                              {rounds * selectedModelIds.length}{' '}
                              {rounds * selectedModelIds.length === 1 ? 'turn' : 'turns'}
                            </span>
                          </div>
                          <div className="grid grid-cols-3 gap-1.5">
                            {Array.from({ length: MAX_DEBATE_ROUNDS }, (_, index) => index + 1).map((value) => (
                              <button
                                key={value}
                                type="button"
                                onClick={() => setRounds(value)}
                                className={`rounded-full px-3 py-1.5 text-[12px] font-medium transition-colors ${
                                  rounds === value
                                    ? 'bg-gray-950 text-white shadow-sm dark:bg-white dark:text-gray-950'
                                    : 'bg-white/70 text-gray-700 hover:bg-white dark:bg-gray-900/70 dark:text-gray-300 dark:hover:bg-gray-900'
                                }`}
                              >
                                {value}
                              </button>
                            ))}
                          </div>
                        </div>

                        <div className="space-y-2">
                          <span className="block px-1 text-[10px] font-medium uppercase tracking-wider text-gray-600 dark:text-gray-400">
                            Speakers
                          </span>
                          <button
                            type="button"
                            onClick={() => setIsModelPickerOpen((value) => !value)}
                            className="flex w-full items-center justify-between gap-2 rounded-full bg-white/70 px-3.5 py-2 text-left text-[12px] font-medium text-gray-800 transition-colors hover:bg-white dark:bg-gray-900/70 dark:text-gray-200 dark:hover:bg-gray-900"
                          >
                            <span className="flex min-w-0 items-center gap-1.5">
                              <span className="flex flex-shrink-0 -space-x-1.5">
                                {selectedModels.slice(0, 4).map((model) => (
                                  <span
                                    key={model.id}
                                    className="flex h-5 w-5 items-center justify-center rounded-full bg-white shadow-sm ring-1 ring-black/5 dark:bg-gray-950 dark:ring-white/10"
                                  >
                                    <ModelIcon model={model} className="h-3 w-3" />
                                  </span>
                                ))}
                              </span>
                              <span className="truncate">
                                {selectedModelIds.length === 0
                                  ? 'pick 2-5 models'
                                  : `${selectedModelIds.length} models · ${selectedModels
                                      .map((m) => m.name)
                                      .join(', ')}`}
                              </span>
                            </span>
                            <ArrowUpRight className="h-3.5 w-3.5 flex-shrink-0 text-gray-500 dark:text-gray-400" />
                          </button>
                        </div>

                        {error && (
                          <div className="flex items-start gap-2 rounded-2xl bg-red-100/80 px-3 py-2 text-[12px] text-red-700 dark:bg-red-950/40 dark:text-red-300">
                            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                            <span>{error}</span>
                          </div>
                        )}
                      </div>

                      <div className="flex flex-shrink-0 items-center gap-2 border-t border-black/5 bg-black/5 px-3 py-3 dark:border-white/10 dark:bg-black/30">
                        <div className="flex min-w-0 flex-1 items-center gap-2 rounded-full bg-white/85 px-3.5 py-1.5 text-xs text-gray-600 dark:bg-gray-900/85 dark:text-gray-400">
                          <span className="truncate">
                            {selectedModelIds.length < 2
                              ? 'pick at least 2 speakers'
                              : `${selectedModelIds.length} speakers · ${rounds} ${rounds === 1 ? 'round' : 'rounds'}`}
                          </span>
                        </div>
                        <button
                          type="submit"
                          disabled={isStarting}
                          className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-[#3D9970] text-white shadow-sm transition-colors hover:bg-[#338560] disabled:cursor-not-allowed disabled:opacity-60"
                          aria-label={isStarting ? 'Starting...' : 'Start debate'}
                        >
                          {isStarting ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <ArrowUp className="h-4 w-4" />
                          )}
                        </button>
                      </div>
                    </form>

                    <div className="flex h-5 flex-shrink-0 items-center justify-center bg-[#d8d6c8] dark:bg-[#1f1f1d]">
                      <span aria-hidden className="h-1 w-28 rounded-full bg-black/70 dark:bg-white/40" />
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </section>

        <aside className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-950">
          {isModelPickerOpen ? (
            <div className="flex h-full min-h-0 flex-col p-4">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-medium text-gray-900 dark:text-white">Models</h2>
                <button
                  type="button"
                  onClick={() => setIsModelPickerOpen(false)}
                  className="rounded-lg p-2 text-gray-500 transition-colors hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-900"
                  aria-label="Close model picker"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="mt-3 flex items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 dark:border-gray-800 dark:bg-gray-900">
                <Search className="h-4 w-4 text-gray-400" />
                <input
                  value={modelSearch}
                  onChange={(event) => setModelSearch(event.target.value)}
                  className="w-full bg-transparent text-sm text-gray-900 outline-none placeholder:text-gray-400 dark:text-white"
                  placeholder="Search models"
                />
              </div>
              <div className="mt-3 flex-1 min-h-0 space-y-2 overflow-y-auto pr-1">
                {filteredModels.map((model) => {
                  const selected = selectedModelIds.includes(model.id);
                  return (
                    <button
                      key={model.id}
                      type="button"
                      onClick={() => toggleModel(model.id)}
                      className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2 text-left transition-colors ${
                        selected
                          ? 'border-[#3D9970] bg-[#3D9970]/10'
                          : 'border-gray-200 hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-900'
                      }`}
                    >
                      <ModelIcon model={model} className="h-5 w-5" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-gray-900 dark:text-white">{model.name}</span>
                        <span className="block truncate text-xs text-gray-500 dark:text-gray-400">
                          {model.author}
                        </span>
                      </span>
                      <span
                        className={`h-4 w-4 rounded-full border ${
                          selected ? 'border-[#3D9970] bg-[#3D9970]' : 'border-gray-300 dark:border-gray-700'
                        }`}
                      />
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="flex h-full min-h-0 flex-col p-4">
              <ThreadPanel
                activeSession={activeSession}
                message={activeThreadMessage}
                models={models}
                value={threadReply}
                isSending={isThreadSending}
                onChange={setThreadReply}
                onClose={() => setActiveThreadMessageId(null)}
                onSubmit={sendThreadReply}
              />
            </div>
          )}
        </aside>
      </div>

      {confirmDelete && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
          onClick={() => !isDeleting && setConfirmDelete(null)}
        >
          <div
            className="w-full max-w-sm rounded-2xl border border-gray-200 bg-white p-5 shadow-2xl dark:border-gray-800 dark:bg-gray-950"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 className="text-base font-semibold text-gray-900 dark:text-white">
              {confirmDelete.kind === 'all' ? 'Clear all debates?' : 'Delete this debate?'}
            </h3>
            <p className="mt-1.5 text-sm text-gray-600 dark:text-gray-400">
              {confirmDelete.kind === 'all'
                ? `This will permanently remove ${sessions.length} saved ${sessions.length === 1 ? 'debate' : 'debates'}, including all turns and replies. This cannot be undone.`
                : `"${confirmDelete.title}" and all its replies will be permanently removed. This cannot be undone.`}
            </p>
            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmDelete(null)}
                disabled={isDeleting}
                className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-60 dark:border-gray-800 dark:text-gray-300 dark:hover:bg-gray-900"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  if (confirmDelete.kind === 'all') deleteAll();
                  else deleteOne(confirmDelete.id);
                }}
                disabled={isDeleting}
                className="flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isDeleting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {confirmDelete.kind === 'all' ? 'Clear all' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function DebateBubble({
  message,
  models,
  isActive,
  isCollapsed,
  onToggleCollapsed,
  onOpenThread,
}: {
  message: DebateMessage;
  models: ModelOption[];
  isActive: boolean;
  isCollapsed: boolean;
  onToggleCollapsed: () => void;
  onOpenThread: () => void;
}) {
  const model = getModel(models, message.modelId);
  const modelName = getModelName(models, message.modelId);
  const lowerName = lowercaseModelName(modelName);
  const threadCount = message.threads.reduce((count, thread) => count + thread.messages.length, 0);
  const replyCount = Math.ceil(threadCount / 2);
  const isError = message.status === 'error';
  const relTime = formatRelativeTime(message.createdAt);

  if (isError) {
    return (
      <article className="px-1">
        <div className="flex items-start gap-2 text-sm text-gray-500 dark:text-gray-500">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium lowercase text-gray-700 dark:text-gray-400">{lowerName}</span>
              <span className="text-[11px]">skipped this turn</span>
            </div>
            <p className="mt-0.5 text-[11px] italic leading-5">{message.text}</p>
          </div>
        </div>
      </article>
    );
  }

  return (
    <article className={`px-1 transition-colors ${isActive ? 'rounded-2xl bg-black/[0.04] dark:bg-white/[0.04]' : ''}`}>
      {/* avatar + name */}
      <div className="mb-1.5 flex items-center gap-2">
        <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md bg-white shadow-sm dark:bg-gray-950">
          <ModelIcon model={model} author={modelName} className="h-3.5 w-3.5" />
        </div>
        <span className="text-[13px] font-medium lowercase text-gray-900 dark:text-white">{lowerName}</span>
      </div>

      {/* body */}
      {!isCollapsed && (
        <p className="whitespace-pre-wrap text-[15px] leading-snug text-gray-950 dark:text-gray-100">
          {message.text}
        </p>
      )}
      {isCollapsed && (
        <p className="line-clamp-1 text-[15px] leading-snug text-gray-700 dark:text-gray-300">
          {message.text}
        </p>
      )}

      {/* footer: full pill · replies link · relative timestamp */}
      <div className="mt-2.5 flex items-center justify-between gap-2 text-[11px]">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onToggleCollapsed}
            className="rounded-full bg-white/85 px-3 py-1 text-[11px] font-medium lowercase text-gray-800 transition-colors hover:bg-white dark:bg-gray-900/80 dark:text-gray-200"
          >
            {isCollapsed ? 'full' : 'less'}
          </button>
          {replyCount > 0 && (
            <button
              type="button"
              onClick={onOpenThread}
              className="flex items-center gap-1 text-[11px] font-medium text-gray-700 underline-offset-4 hover:underline dark:text-gray-300"
            >
              <span aria-hidden>↩</span>
              <span>{replyCount} {replyCount === 1 ? 'reply' : 'replies'}</span>
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={onOpenThread}
          className="text-[11px] text-gray-500 dark:text-gray-500"
          title={DEBATE_ROLE_LABELS[message.role]}
        >
          {relTime}
        </button>
      </div>
    </article>
  );
}

function ThreadPanel({
  activeSession,
  message,
  models,
  value,
  isSending,
  onChange,
  onClose,
  onSubmit,
}: {
  activeSession?: DebateSession;
  message: DebateMessage | null;
  models: ModelOption[];
  value: string;
  isSending: boolean;
  onChange: (value: string) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  if (!activeSession || !message) {
    return (
      <div className="flex h-full min-h-0 flex-1 items-center justify-center text-center">
        <div>
          <h2 className="text-base font-medium text-gray-900 dark:text-white">Open a thread</h2>
          <p className="mt-2 text-sm leading-6 text-gray-500 dark:text-gray-400">
            Click full on any answer to question it, ask for proof, or continue the side debate.
          </p>
        </div>
      </div>
    );
  }

  const model = getModel(models, message.modelId);
  const modelName = getModelName(models, message.modelId);
  const thread = message.threads[0];

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-500">Thread</p>
          <h2 className="mt-1 text-base font-medium text-gray-900 dark:text-white">{modelName}</h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg p-2 text-gray-500 transition-colors hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-900"
          aria-label="Close thread"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-900">
        <div className="mb-2 flex items-center gap-2">
          <ModelIcon model={model} author={modelName} className="h-4 w-4" />
          <span className="text-sm font-medium text-gray-900 dark:text-white">{modelName}</span>
        </div>
        <p className="line-clamp-5 whitespace-pre-wrap text-sm leading-6 text-gray-600 dark:text-gray-400">{message.text}</p>
      </div>

      <div className="mt-4 flex-1 min-h-0 space-y-3 overflow-y-auto pr-1">
        {!thread && <p className="text-sm text-gray-500 dark:text-gray-400">No thread yet. Start with a reply below.</p>}
        {thread?.messages.map((threadMessage) => (
          <div
            key={threadMessage.id}
            className={`rounded-xl border px-3 py-2 ${
              threadMessage.isUser
                ? 'ml-8 border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-950'
                : 'mr-8 border-gray-200 bg-gray-50 dark:border-gray-800 dark:bg-gray-900'
            }`}
          >
            <div className="mb-1 flex items-center gap-2">
              {!threadMessage.isUser && (
                <ModelIcon model={getModel(models, threadMessage.modelId)} author={getModelName(models, threadMessage.modelId)} className="h-4 w-4" />
              )}
              <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
                {threadMessage.isUser ? 'You' : getModelName(models, threadMessage.modelId)}
              </span>
            </div>
            <p className="whitespace-pre-wrap text-sm leading-6 text-gray-800 dark:text-gray-200">{threadMessage.text}</p>
          </div>
        ))}
      </div>

      <form onSubmit={onSubmit} className="mt-4">
        <textarea
          value={value}
          onChange={(event) => onChange(event.target.value)}
          rows={4}
          className="w-full resize-none rounded-xl border border-gray-200 bg-gray-50 px-3 py-3 text-sm leading-6 text-gray-900 outline-none transition-colors placeholder:text-gray-400 focus:border-[#3D9970] dark:border-gray-800 dark:bg-gray-900 dark:text-white"
          placeholder="Ask for proof, push back, or continue this thread..."
        />
        <button
          type="submit"
          disabled={isSending || !value.trim()}
          className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-gray-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-200"
        >
          {isSending && <Loader2 className="h-4 w-4 animate-spin" />}
          Reply
        </button>
      </form>
    </div>
  );
}
