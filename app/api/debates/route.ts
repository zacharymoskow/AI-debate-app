import { NextRequest, NextResponse } from 'next/server';
import { callConcentrateText } from '@/lib/concentrate';
import { findModelById } from '@/lib/models';
import { prisma } from '@/lib/prisma';
import {
  DebateMode,
  DebateRole,
  DebateTurnTranscript,
  buildDebateTitle,
  buildFollowupPrompt,
  buildStarterPrompt,
  buildSummaryPrompt,
  clampRounds,
  isDebateMode,
  shuffleArray,
} from '@/lib/debate';

interface DebateTurnInput {
  modelId: string;
  speakerName: string;
  role: DebateRole;
  text: string;
}

function modelDisplayName(modelId: string): string {
  return findModelById(modelId)?.name || modelId;
}

function isReasoningModel(modelId: string): boolean {
  return Boolean(findModelById(modelId)?.supportsReasoning);
}

function turnTokens(modelId: string, isStarter: boolean): number {
  if (isReasoningModel(modelId)) return isStarter ? 1600 : 1400;
  return isStarter ? 480 : 420;
}

function turnTimeout(modelId: string): number {
  return isReasoningModel(modelId) ? 60000 : 40000;
}

function serializeSession(session: {
  id: string;
  title: string;
  question: string;
  context: string | null;
  mode: string;
  selectedModels: string;
  summary: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  messages: Array<{
    id: string;
    sessionId: string;
    modelId: string | null;
    role: string;
    text: string;
    order: number;
    createdAt: Date;
    threads: Array<{
      id: string;
      sessionId: string;
      parentMessageId: string;
      createdAt: Date;
      updatedAt: Date;
      messages: Array<{
        id: string;
        threadId: string;
        modelId: string | null;
        isUser: boolean;
        text: string;
        order: number;
        createdAt: Date;
      }>;
    }>;
  }>;
  threads: Array<{
    id: string;
    sessionId: string;
    parentMessageId: string;
    createdAt: Date;
    updatedAt: Date;
    messages: Array<{
      id: string;
      threadId: string;
      modelId: string | null;
      isUser: boolean;
      text: string;
      order: number;
      createdAt: Date;
    }>;
  }>;
}) {
  return {
    ...session,
    mode: isDebateMode(session.mode) ? session.mode : 'balanced',
    selectedModels: JSON.parse(session.selectedModels) as string[],
    createdAt: session.createdAt.toISOString(),
    updatedAt: session.updatedAt.toISOString(),
    messages: session.messages.map((message) => ({
      ...message,
      role: message.role as DebateRole,
      createdAt: message.createdAt.toISOString(),
      threads: message.threads.map((thread) => ({
        ...thread,
        createdAt: thread.createdAt.toISOString(),
        updatedAt: thread.updatedAt.toISOString(),
        messages: thread.messages.map((threadMessage) => ({
          ...threadMessage,
          createdAt: threadMessage.createdAt.toISOString(),
        })),
      })),
    })),
    threads: session.threads.map((thread) => ({
      ...thread,
      createdAt: thread.createdAt.toISOString(),
      updatedAt: thread.updatedAt.toISOString(),
      messages: thread.messages.map((threadMessage) => ({
        ...threadMessage,
        createdAt: threadMessage.createdAt.toISOString(),
      })),
    })),
  };
}

export async function DELETE() {
  try {
    const result = await prisma.debateSession.deleteMany({});
    return NextResponse.json({ ok: true, deleted: result.count });
  } catch (error) {
    console.error('[Debate] Failed to clear debates', error);
    return NextResponse.json({ error: 'Could not clear debates.' }, { status: 500 });
  }
}

export async function GET() {
  try {
    const sessions = await prisma.debateSession.findMany({
      orderBy: { updatedAt: 'desc' },
      take: 20,
      include: {
        messages: {
          orderBy: { order: 'asc' },
          include: {
            threads: {
              orderBy: { updatedAt: 'desc' },
              include: { messages: { orderBy: { order: 'asc' } } },
            },
          },
        },
        threads: {
          orderBy: { updatedAt: 'desc' },
          include: { messages: { orderBy: { order: 'asc' } } },
        },
      },
    });

    return NextResponse.json(sessions.map(serializeSession));
  } catch (error) {
    console.error('[Debate] Failed to list debates', error);
    return NextResponse.json({ error: 'Could not load debates.' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  let question: string;
  let mode: DebateMode;
  let requestedModelIds: string[];
  let rounds: number;

  try {
    const body = (await request.json()) as {
      question?: unknown;
      mode?: unknown;
      modelIds?: unknown;
      rounds?: unknown;
    };

    question = typeof body.question === 'string' ? body.question.trim() : '';
    mode = isDebateMode(body.mode) ? body.mode : 'balanced';
    requestedModelIds = Array.isArray(body.modelIds)
      ? body.modelIds
          .filter((modelId): modelId is string => typeof modelId === 'string' && modelId.trim().length > 0)
          .slice(0, 5)
      : [];
    rounds = clampRounds(body.rounds);

    if (!question) {
      return NextResponse.json({ error: 'Enter a question to debate.' }, { status: 400 });
    }
    if (requestedModelIds.length < 2) {
      return NextResponse.json({ error: 'Select at least two models.' }, { status: 400 });
    }
  } catch (error) {
    console.error('[Debate] Invalid debate request', error);
    return NextResponse.json({ error: 'Invalid debate request.' }, { status: 400 });
  }

  const initialOrder = shuffleArray(requestedModelIds);

  const session = await prisma.debateSession.create({
    data: {
      title: buildDebateTitle(question),
      question,
      context: null,
      mode,
      selectedModels: JSON.stringify(initialOrder),
      summary: null,
      status: 'running',
    },
  });

  const sessionId = session.id;
  const startedAt = Date.now();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (event: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };

      try {
        send({
          type: 'session',
          session: {
            id: sessionId,
            title: session.title,
            question: session.question,
            context: session.context,
            mode,
            selectedModels: initialOrder,
            summary: null,
            status: 'running',
            createdAt: session.createdAt.toISOString(),
            updatedAt: session.updatedAt.toISOString(),
            messages: [],
            threads: [],
          },
        });

        const roleCycle: DebateRole[] = ['challenge', 'add_on', 'red_team'];
        const generatedTurns: DebateTurnInput[] = [];
        let order = 0;

        for (let roundIndex = 0; roundIndex < rounds; roundIndex += 1) {
          const speakerOrder = roundIndex === 0 ? initialOrder : shuffleArray(initialOrder);
          const roleOffset = Math.floor(Math.random() * roleCycle.length);

          for (let position = 0; position < speakerOrder.length; position += 1) {
            const modelId = speakerOrder[position];
            const speakerName = modelDisplayName(modelId);
            const otherNames = initialOrder
              .filter((id) => id !== modelId)
              .map((id) => modelDisplayName(id));

            const isFirstTurn = generatedTurns.length === 0;
            const role: DebateRole = isFirstTurn
              ? 'starter'
              : roleCycle[(generatedTurns.length - 1 + roleOffset + roundIndex) % roleCycle.length];

            const transcript: DebateTurnTranscript[] = generatedTurns.map((turn) => ({
              speakerName: turn.speakerName,
              role: turn.role,
              text: turn.text,
            }));

            const prompt = isFirstTurn
              ? buildStarterPrompt({ selfName: speakerName, otherNames, question, mode })
              : buildFollowupPrompt({
                  selfName: speakerName,
                  otherNames,
                  question,
                  previousTurns: transcript,
                  role,
                  mode,
                });

            let text = '';
            let failed = false;
            try {
              text = await callConcentrateText({
                model: modelId,
                input: prompt,
                maxOutputTokens: turnTokens(modelId, isFirstTurn),
                timeoutMs: turnTimeout(modelId),
              });
            } catch (error) {
              failed = true;
              text = error instanceof Error ? error.message : `${speakerName} could not respond.`;
              console.warn('[Debate] Turn failed', {
                sessionId: sessionId.substring(0, 8),
                modelId,
                role,
                error: text,
              });
            }

            const cleaned = text.trim();

            if (failed || cleaned.length === 0) {
              const failureText = cleaned || `${speakerName} did not return a reply. Try again or remove that model.`;
              send({
                type: 'message',
                message: {
                  id: `error-${sessionId}-${order}`,
                  sessionId,
                  modelId,
                  role,
                  text: failureText,
                  order,
                  createdAt: new Date().toISOString(),
                  threads: [],
                  status: 'error',
                },
              });
              order += 1;
              continue;
            }

            generatedTurns.push({ modelId, speakerName, role, text: cleaned });

            const persisted = await prisma.debateMessage.create({
              data: {
                sessionId,
                modelId,
                role,
                text: cleaned,
                order,
              },
            });

            send({
              type: 'message',
              message: {
                id: persisted.id,
                sessionId,
                modelId: persisted.modelId,
                role: persisted.role as DebateRole,
                text: persisted.text,
                order: persisted.order,
                createdAt: persisted.createdAt.toISOString(),
                threads: [],
                status: 'ok',
              },
            });

            order += 1;
          }
        }

        const summaryTranscript: DebateTurnTranscript[] = generatedTurns.map((turn) => ({
          speakerName: turn.speakerName,
          role: turn.role,
          text: turn.text,
        }));

        let summary: string;
        if (summaryTranscript.length === 0) {
          summary = 'No model produced a usable reply. Try again or pick different models.';
        } else {
          const summaryModel = generatedTurns[0]?.modelId ?? initialOrder[0];
          try {
            summary = await callConcentrateText({
              model: summaryModel,
              input: buildSummaryPrompt({ question, messages: summaryTranscript }),
              maxOutputTokens: isReasoningModel(summaryModel) ? 1200 : 320,
              timeoutMs: isReasoningModel(summaryModel) ? 45000 : 25000,
            });
            if (!summary.trim()) {
              throw new Error('empty summary');
            }
          } catch (error) {
            console.error('[Debate] Summary failed', error);
            const namedSpeakers = Array.from(new Set(generatedTurns.map((t) => t.speakerName)));
            const named = namedSpeakers.slice(0, 2).join(' and ') || 'the models';
            summary = `${named} disagreed on framing — open a thread on any answer to push deeper.`;
          }
        }

        const cleanedSummary = summary.trim();
        await prisma.debateSession.update({
          where: { id: sessionId },
          data: { summary: cleanedSummary, status: 'completed' },
        });

        send({ type: 'done', summary: cleanedSummary });

        console.log('[Debate] Streamed session', {
          id: sessionId.substring(0, 8),
          models: initialOrder.length,
          rounds,
          mode,
          turns: generatedTurns.length,
          ms: Date.now() - startedAt,
        });
      } catch (error) {
        console.error('[Debate] Stream failed', error);
        send({
          type: 'error',
          error: error instanceof Error ? error.message : 'Could not finish the debate.',
        });
        try {
          await prisma.debateSession.update({
            where: { id: sessionId },
            data: { status: 'failed' },
          });
        } catch {
          // ignore secondary failure
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    },
  });
}
