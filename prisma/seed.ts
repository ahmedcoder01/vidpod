/**
 * Seeds the dev SQLite database with the same fixtures as the old in-memory
 * mock store so the dev experience is unchanged once routes flip to Prisma.
 *
 * Run: `npm run db:seed` (or `tsx prisma/seed.ts`)
 */
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { mockAds, mockPodcastShows, mockPodcasts, mockUser } from '../src/lib/mock-data';

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL ?? 'postgresql://vidpod:vidpod-dev-pw@localhost:5432/vidpod',
});
const prisma = new PrismaClient({ adapter });

// Default dev password so the seeded user can log in via the UI.
const DEV_PASSWORD = 'password123';

async function main() {
  // User
  const passwordHash = await bcrypt.hash(DEV_PASSWORD, 11);
  const user = await prisma.user.upsert({
    where: { email: mockUser.email },
    update: { name: mockUser.name, avatar: mockUser.avatar, passwordHash },
    create: {
      id: mockUser.id,
      email: mockUser.email,
      name: mockUser.name,
      avatar: mockUser.avatar,
      passwordHash,
    },
  });
  console.log(`✔ user: ${user.email}  (dev password: ${DEV_PASSWORD})`);

  // Podcasts (the shows that contain episodes). Seed all mockPodcastShows
  // under the seed user so the sidebar dropdown has real data to render.
  for (const show of mockPodcastShows) {
    await prisma.podcast.upsert({
      where: { id: show.id },
      update: {
        title: show.title,
        description: show.description ?? '',
        coverArt: show.coverArt,
        initials: show.initials,
        coverGradient: show.coverGradient,
        ownerId: user.id,
      },
      create: {
        id: show.id,
        title: show.title,
        description: show.description ?? '',
        coverArt: show.coverArt,
        initials: show.initials,
        coverGradient: show.coverGradient,
        ownerId: user.id,
      },
    });
    console.log(`✔ podcast: ${show.id} (${show.title})`);
  }

  // Ads (library)
  for (const ad of mockAds) {
    await prisma.ad.upsert({
      where: { id: ad.id },
      update: {
        title: ad.title,
        advertiser: ad.advertiser,
        campaign: ad.campaign,
        duration: ad.duration,
        thumbnail: ad.thumbnail,
        videoUrl: ad.videoUrl,
        tags: JSON.stringify(ad.tags ?? []),
        uploaderId: user.id,
      },
      create: {
        id: ad.id,
        title: ad.title,
        advertiser: ad.advertiser,
        campaign: ad.campaign,
        duration: ad.duration,
        thumbnail: ad.thumbnail,
        videoUrl: ad.videoUrl,
        tags: JSON.stringify(ad.tags ?? []),
        uploaderId: user.id,
      },
    });
    console.log(`✔ ad:   ${ad.id} (${ad.title})`);
  }

  // All seeded videos belong to the first mock podcast (Diary Of A CEO) since
  // the current mock fixtures are episodes of that show.
  const defaultPodcastId = mockPodcastShows[0]?.id;
  if (!defaultPodcastId) throw new Error('No mockPodcastShows to attach videos to');

  // Videos (+ their ad markers, + renditions if present)
  for (const p of mockPodcasts) {
    await prisma.video.upsert({
      where: { id: p.id },
      update: {
        title: p.title,
        description: p.description,
        author: p.author,
        status: p.status,
        episode: p.episode,
        duration: p.duration ?? 0,
        thumbnail: p.thumbnail,
        fullS3Url: p.fullS3Url,
        chunksURL: p.chunksURL,
        waveformData: JSON.stringify(p.waveformData ?? []),
        podcastId: defaultPodcastId,
        ownerId: user.id,
      },
      create: {
        id: p.id,
        title: p.title,
        description: p.description,
        author: p.author,
        status: p.status,
        episode: p.episode,
        duration: p.duration ?? 0,
        thumbnail: p.thumbnail,
        fullS3Url: p.fullS3Url,
        chunksURL: p.chunksURL,
        waveformData: JSON.stringify(p.waveformData ?? []),
        podcastId: defaultPodcastId,
        ownerId: user.id,
      },
    });

    // Wipe + reinsert markers so re-running the seed converges on the mock.
    await prisma.adMarker.deleteMany({ where: { videoId: p.id } });
    for (const m of p.adMarkers) {
      await prisma.adMarker.create({
        data: {
          id: m.id,
          type: m.type,
          startTime: m.startTime,
          label: m.label,
          videoId: p.id,
          markerAds: {
            create: (m.adIds ?? []).map((adId, idx) => ({ adId, position: idx })),
          },
        },
      });
    }

    await prisma.rendition.deleteMany({ where: { videoId: p.id } });
    for (const r of p.renditions ?? []) {
      await prisma.rendition.create({
        data: {
          resolution: r.resolution,
          playlistUrl: r.playlistUrl,
          bitrateKbps: r.bitrateKbps,
          width: r.width,
          height: r.height,
          videoId: p.id,
        },
      });
    }

    console.log(`✔ video: ${p.id} (${p.adMarkers.length} markers, ${(p.renditions ?? []).length} renditions)`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
