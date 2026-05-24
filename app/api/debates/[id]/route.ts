import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const session = await prisma.debateSession.findUnique({ where: { id } });
    if (!session) {
      return NextResponse.json({ error: 'Not found.' }, { status: 404 });
    }
    await prisma.debateSession.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[Debate] Failed to delete debate', error);
    return NextResponse.json({ error: 'Could not delete debate.' }, { status: 500 });
  }
}
