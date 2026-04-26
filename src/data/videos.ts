export interface Video {
  slug: string;
  title: string;
  description: string;
  youtubeId: string;
  date: string;
}

export const videos: Video[] = [

  {
    slug: "art-time",
    title: "My introdution video",
    description: " introducing my website",
    youtubeId: "sXQhrUxiZS0",
    date: "2026-04-21",
  },
  {
    slug: "dance-party",
    title: " glam slime day 1",
    description: "adding lip products to slime",
    youtubeId: "sXQhrUxiZS0",
    date: "2026-04-21",
  },
  {
    slug: "slime-making",
    title: "glam slime day 2",
    description: "adding more products",
    youtubeId: "sXQhrUxiZS0",
    date: "2026-04-21",
  },

];

export function sortedVideos(): Video[] {
  return [...videos].sort((a, b) => b.date.localeCompare(a.date));
}
