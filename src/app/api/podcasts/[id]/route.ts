import { NextResponse } from 'next/server';
import { store } from '@/lib/store';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const podcast = store.getPodcast(id);
  if (!podcast) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(podcast);
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const updated = store.updatePodcast(id, body);
  if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(updated);
}
