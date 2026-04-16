import { NextResponse } from 'next/server';
import { store } from '@/lib/store';

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string; markerId: string }> }) {
  const { id, markerId } = await params;
  const podcast = store.getPodcast(id);
  if (!podcast) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const body = await req.json();
  const markers = podcast.adMarkers.map((m) => (m.id === markerId ? { ...m, ...body } : m));
  store.updatePodcast(id, { adMarkers: markers });
  return NextResponse.json(markers.find((m) => m.id === markerId));
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string; markerId: string }> }) {
  const { id, markerId } = await params;
  const podcast = store.getPodcast(id);
  if (!podcast) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const markers = podcast.adMarkers.filter((m) => m.id !== markerId);
  store.updatePodcast(id, { adMarkers: markers });
  return NextResponse.json({ success: true });
}
