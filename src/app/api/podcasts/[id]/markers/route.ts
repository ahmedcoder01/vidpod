import { NextResponse } from 'next/server';
import { store } from '@/lib/store';
import { generateId } from '@/lib/utils';
import { AdMarker } from '@/lib/types';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const podcast = store.getPodcast(id);
  if (!podcast) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const body = await req.json();
  const marker: AdMarker = {
    id: generateId(),
    type: body.type,
    startTime: body.startTime,
    assetUrl: body.assetUrl,
    assetUrls: body.assetUrls,
    label: body.label,
  };

  const markers = [...podcast.adMarkers, marker];
  store.updatePodcast(id, { adMarkers: markers });
  return NextResponse.json(marker, { status: 201 });
}
