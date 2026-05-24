import { NextRequest, NextResponse } from 'next/server';
import { buildThreadPrompt } from '@/lib/debate';
import { callConcentrateText } from '@/lib/concentrate';
import { findModelById } from '@/lib/models';
import { prisma } from '@/lib/prisma';

function modelDisplayName(modelId: string | null | undefined): string {
  if (!modelId) return 'a model';
  return findModelById(modelId)?.name || modelId;
}

function isReasoningModel(modelId: string): boolean {
  return Boolean(findModelById(modelId)?.supportsReasoning);
}

function serializeThread(thread: {
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
}) {
  return {
    ...thread,
    createdAt: thread.createdAt.toISOString(),
    updatedAt: thread.updatedAt.toISOString(),
    messages: thread.messages.map((message) => ({
      ...message,
      createdAt: message.createdAt.toISOString(),
    })),
  };
}

function selectThreadModel(selectedModels: string[], parentModelId: string | null): string {
  if (selectedModels.length === 0) return parentModelId || 'gpt-4o-mini';
  const parentIndex = parentModelId ? selectedModels.indexOf(parentModelId) : -1;
  return selectedModels[(parentIndex + 1 + selectedModels.length) % selectedModels.length];
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = (await request.json()) as {
      parentMessageId?: unknown;
      text?: unknown;
    };
    const parentMessageId = typeof body.parentMessageId === 'string' ? body.parentMessageId : '';
    const text = typeof body.text === 'string' ? body.text.trim() : '';

    if (!parentMessageId || !text) {
      return NextResponse.json({ error: 'Add a reply before opening the thread.' }, { status: 400 });
    }

    const session = await prisma.debateSession.findUnique({
      where: { id },
      include: { messages: true },
    });

    if (!session) {
      return NextResponse.json({ error: 'Debate not found.' }, { status: 404 });
    }

    const parentMessage = session.messages.find((message) => message.id === parentMessageId);
    if (!parentMessage) {
      return NextResponse.json({ error: 'Debate message not found.' }, { status: 404 });
    }

    const selectedModels = JSON.parse(session.selectedModels) as string[];
    const replyModel = selectThreadModel(selectedModels, parentMessage.modelId);
    const existingThread = await prisma.debateThread.findFirst({
      where: { sessionId: session.id, parentMessageId },
      include: { messages: { orderBy: { order: 'asc' } } },
    });
    const nextOrder = existingThread?.messages.length ?? 0;

    const thread = existingThread
      ? await prisma.debateThread.update({
          where: { id: existingThread.id },
          data: {
            messages: {
              create: {
                isUser: true,
                text,
                order: nextOrder,
              },
            },
          },
          include: { messages: { orderBy: { order: 'asc' } } },
        })
      : await prisma.debateThread.create({
          data: {
            sessionId: session.id,
            parentMessageId,
            messages: {
              create: {
                isUser: true,
                text,
                order: 0,
              },
            },
          },
          include: { messages: { orderBy: { order: 'asc' } } },
        });

    let modelReply: string;
    try {
      modelReply = await callConcentrateText({
        model: replyModel,
        input: buildThreadPrompt({
          parentSpeakerName: modelDisplayName(parentMessage.modelId),
          parentText: parentMessage.text,
          userReply: text,
          selfName: modelDisplayName(replyModel),
        }),
        maxOutputTokens: isReasoningModel(replyModel) ? 1500 : 480,
        timeoutMs: isReasoningModel(replyModel) ? 60000 : 40000,
      });
    } catch (error) {
      modelReply = error instanceof Error ? error.message : 'The model could not reply to this thread.';
    }

    const updatedThread = await prisma.debateThread.update({
      where: { id: thread.id },
      data: {
        messages: {
          create: {
            modelId: replyModel,
            isUser: false,
            text: modelReply,
            order: thread.messages.length,
          },
        },
      },
      include: { messages: { orderBy: { order: 'asc' } } },
    });

    await prisma.debateSession.update({
      where: { id: session.id },
      data: { updatedAt: new Date() },
    });

    return NextResponse.json(serializeThread(updatedThread));
  } catch (error) {
    console.error('[DebateThread] Failed to save thread', error);
    return NextResponse.json({ error: 'Could not update the thread.' }, { status: 500 });
  }
}
