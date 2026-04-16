import { NextResponse } from 'next/server';
import { store } from '@/lib/store';
import { generateId } from '@/lib/utils';
import { Podcast } from '@/lib/types';

export async function GET() {
  return NextResponse.json(store.getPodcasts());
}

export async function POST(req: Request) {
  const body = await req.json();
  const podcast: Podcast = {
    id: generateId(),
    title: body.title,
    description: body.description || '',
    author: body.author || 'Unknown',
    status: 'uploaded',
    episode: body.episode,
    date: new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }),
    duration: body.duration,
    thumbnail: body.thumbnail,
    videoUrl: body.videoUrl || '',
    adMarkers: [],
    waveformData: Array.from({ length: 500 }, () => 0.3 + Math.random() * 0.4),
  };
  store.addPodcast(podcast);
  return NextResponse.json(podcast, { status: 201 });
}
