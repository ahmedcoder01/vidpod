import { Ad, AdMarker, Podcast, PodcastShow, User } from "./types";

export const mockUser: User = {
  id: "u1",
  name: "Emma Warren",
  email: "emma@thediary.com",
};

// Generate waveform data
function genWaveform(points: number): number[] {
  const data: number[] = [];
  for (let i = 0; i < points; i++) {
    const base = 0.3 + Math.random() * 0.4;
    const spike = Math.random() > 0.85 ? Math.random() * 0.3 : 0;
    data.push(Math.min(1, base + spike));
  }
  return data;
}

const N8N_AD_URL =
  "https://vidpod-demo.s3.us-east-2.amazonaws.com/ad1.mp4?response-content-disposition=inline&X-Amz-Content-Sha256=UNSIGNED-PAYLOAD&X-Amz-Security-Token=IQoJb3JpZ2luX2VjEP%2F%2F%2F%2F%2F%2F%2F%2F%2F%2F%2FwEaCXVzLWVhc3QtMiJIMEYCIQDdM2ToR45vlcizGfuPZBqw2dfjlSsJ9TyLkBX96queOAIhAPsM8UpULGx8rfRZ4wfpd%2BrQe38XLD7ApQ2AS6WanKAqKr4DCMj%2F%2F%2F%2F%2F%2F%2F%2F%2F%2FwEQABoMMTQ3NzIzMDM2NzEyIgxS0WeFQRgx31iAn3wqkgNKzfJ3K6DJhrYv2vsTJ0aOBPtpolMKoEFxcOZDbnj7FqIGoXYPjRNH3lrUqPhjrTceUnhNF5e0FOy8oCXpw9WGA80rJTnLMNHmyH0ONf9cgQCzisy23Nk9l4Cf4a%2FdQiFCOSa%2BuXR3vZSW9iUt7w7fZx%2BGdG2zVcZuiufAPJ9b%2BligSsZ06Oqt0Ks%2B0IuZmRZ5jC1lpzlq%2FHvPfwn8gKlfP%2BwwnuKoXWj9ScsOZ143oi%2Fa7VmqXRHGw5GWHGyVbrx7OXg25xIwuPf6QA1ME2AseY1xaeq9Ns92OZAn95nk38vHkuqA2L1EtT24oAP5Yh7yihILleOR99Z8IiXmi7lgq5tsbSk0Ow4J37VlBO2k3cONHeStPfE3cBTWbuElx76ZiYQBQ3X1YrFQtgiCdqpW0qpIJEY0DqdsGB6mZl2ZSlr6zR2O6%2FSLLaBlzl%2FiDIktYi8AXmKXZv9NXi3cS%2BpTudGMa%2Fx1rkD7KWwk0sv5AnFK4AV4OMhHMMhnHO%2F9fGzfatoMcuxB2ejpBAlgySmDPF8ws4GFzwY63QJLtoNbr45viuPwTm6CL0aziBqpRziuBSE7%2BmLL9DBr%2F6pGi3nL9TL8oVvKdtbuSjZ8NSy5O6yrpLjvP8%2Bv%2FbLYGUHWlu06IK7HP64eLj2Nf9kfjmRjxmiwpuD54sf1UeXXlsUg8ir9meYJONZaWpbsh5ex14O%2BYceJM%2B2iDID4Eh0cFboyuGIg2NIs%2BNjs45iNYT3S7mR6Q6tJ8MmTWcYgvew7erVYk0bjrPYWAvo%2BtM8qFpGaRcp5POuF4ee0Sda%2BN%2BYYFw1ZY%2Fl1fqj1TFxzjuKDnNXdryN8x1y1Zjo9GGliAxqNb%2FhARixuaGAggh6YKXCqcMUMidw9VF%2F5Lg8APfVnGWyxXBXgT1TwlTEpnY71sZKY3xWSrghMxfBVnbS%2BuwbSCPqU5UzqHO3%2F7Zogr%2Bh9PwsmdF9tznOhuh15ekBT%2F5AXCY8NFJVQ3yziXsfL8wf340QhEVpcPvlv&X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=ASIASEZH2VAUOBJSNYJP%2F20260416%2Fus-east-2%2Fs3%2Faws4_request&X-Amz-Date=20260416T224309Z&X-Amz-Expires=43200&X-Amz-SignedHeaders=host&X-Amz-Signature=da980f74393ad746b1c496fc20dfdabc071600eaeb65f4ca2cc0408b88d51ea2";

export const mockAds: Ad[] = [
  {
    id: "ad1",
    title: "n8n",
    advertiser: "n8n",
    campaign: "n8n",
    duration: 70,
    videoUrl: N8N_AD_URL,
    tags: ["n8n"],
  },
];

const STEVEN_VIDEO_URL =
  "https://vidpod-demo.s3.us-east-2.amazonaws.com/YTDown.com_YouTube_Meet-Steven-Bartlett-The-College-Dropout_Media_gCS0-1YhmPw_001_1080p.mp4?response-content-disposition=inline&X-Amz-Content-Sha256=UNSIGNED-PAYLOAD&X-Amz-Security-Token=IQoJb3JpZ2luX2VjEPz%2F%2F%2F%2F%2F%2F%2F%2F%2F%2FwEaCXVzLWVhc3QtMiJHMEUCIQCqXgRHguP78846Rqzqjf0RSg8tt%2FgLbFuZpkoTt7uOMAIgDpduYhDSYBCYldZ0WnnFShYpKUYdlxirzEM8%2BfcnI78qvgMIxf%2F%2F%2F%2F%2F%2F%2F%2F%2F%2FARAAGgwxNDc3MjMwMzY3MTIiDAIqdGS4MM8tjC8zYyqSA90LNL0HGKIwNWvMrORfdGf98%2Fs37Gf7mYsCtRQdB187B2Daba6HPgHeueFlqoXravSeSAJJ33Ox%2FP0FECzq3dEzHsagO8lqAcrF64f0JSEv6vy%2FOydppf0Fyj2DOCUUUqM6xJhfjbJjwYke90KoSTOA0b39aEi04xYTE5k4nxw6xYWs6E9YlkIKKXzcRe8D1Y9JzMfmqeJHKAczF5Hj3KnK%2F%2FE6uxauxvBoD0GUc1KJlv0wYFsgIAC48rl%2F%2BphgdZZbTIGNWKgX2SbnMhF99PcEhopN21pAlDv3N9a7ZDKD28vdh%2BD15SNnesdwWKNFB26h5W7OveM5xktlkznmxXRezToMDUvM3BWlw0NQXtaaZsgvcgIDxd%2BTl6UPNcdokoGCMH%2FzEYdy0S3lqFDqhuFUvtJyePaifxjqAorBl3gpWfvFmyK%2FdY8gXtmnB%2BqCT%2B0f6nHjoOFkdQRUwOrPt2nf4i4xDHNCPr%2BOxzoWayNIiD2Zr6oEtgElMUwD8s4F20Kvdt1SnvQXhbau8xufLysbizCzgYXPBjreAvGqalUvalluQ9OHlP86vkDQ3vtzJWH%2FwwlRsarbVYUCARMnFQ3bLLnnz6lpIyM1%2Ftmu6Bp6JXZzX49AtIi82kCgqBVEGQkvURyVNh77HCuQ93WxpnJqGG%2FGv2oFO1ayvjJe8DlnMtMWiBEh0z4RlEb580pdhnqi8sJakD9B63z68bVvlfGun6HD1%2FKf60jv9DjXdQdSOfnEruo7LUzYLLYTFe8w5iVxL5O%2FAqpf6tQNJTBfUyv6MEHhsoFSpPFX8F1gQr2%2Fr%2ByskyvTY0YhfGSagxQIGCSEqtMUudGDKJpLJZE3vtgdZFbbXPCn%2BtzOHlWKgCUWn1tSpueZdvlxQmxKoVtInrZElv4FpIuN0c7OmWr8myV7QO0m82LMeq%2FSwELzzVPcA%2BfxKlFUgiaREqVV%2FeWjhGIzpSTNfvb9pV93UwMBeZ%2FpEJSiXzoMxjPGHzzW%2By4%2FDh8DVIyo7o85&X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=ASIASEZH2VAUHQOBBOC5%2F20260416%2Fus-east-2%2Fs3%2Faws4_request&X-Amz-Date=20260416T201156Z&X-Amz-Expires=43200&X-Amz-SignedHeaders=host&X-Amz-Signature=fda7726c3671aec0e67b76d179ad4aa6dfb194b618840776abf13d057a150663";

export const mockPodcasts: Podcast[] = [
  {
    id: "p1",
    title:
      "Meet Steven Bartlett: The College Dropout Who Built A Podcast Empire (Diary Of A CEO Origin Story)",
    description:
      "The origin story of how a college dropout became one of the most successful podcast creators in the world.",
    author: "The Diary Of A CEO",
    status: "completed",
    episode: "S1:E1",
    date: "16 April 2026",
    duration: 0,
    thumbnail: "",
    videoUrl: STEVEN_VIDEO_URL,
    adMarkers: [],
    waveformData: genWaveform(500),
  },
];

export const adCampaigns = ["All Videos", "n8n"];

// Podcast shows (feeds/channels). Mocked for now — will be swapped for a
// `/api/me/podcasts` response once the DB has a Podcast table.
export const mockPodcastShows: PodcastShow[] = [
  {
    id: "show-diary",
    title: "The Diary Of A CEO",
    description: "Honest conversations with Steven Bartlett.",
    initials: "DC",
    coverGradient: "from-orange-400 to-red-500",
  },
  {
    id: "show-founders",
    title: "Founders Edge",
    description: "Stories from operators who shipped.",
    initials: "FE",
    coverGradient: "from-indigo-400 to-purple-500",
  },
  {
    id: "show-metrics",
    title: "Metrics & Madness",
    description: "Dashboards, experiments, and the people who run them.",
    initials: "MM",
    coverGradient: "from-emerald-400 to-teal-500",
  },
];
