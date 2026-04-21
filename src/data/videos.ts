export interface Video {
  slug: string;
  title: string;
  description: string;
  youtubeId?: string;
  videoPath?: string;
  date: string;
}

export const videos: Video[] = [
  {
    slug: "dance-party",
    title: "Dance Party Fun",
    description: "Having the best time dancing and vibing! Come dance with me! 🎉",
    videoPath: "/videos/IMG_4207.mov",
    date: "2026-04-21",
  },
  {
    slug: "art-time",
    title: "My Art Journey",
    description: "Today I'm showing you some of my favorite art techniques and creations!",
    videoPath: "/videos/IMG_4211.mov",
    date: "2026-04-21",
  },
  {
    slug: "slime-making",
    title: "Making Slime!",
    description: "Let's make the most satisfying slime ever! Perfect, fluffy, and so fun to play with!",
    videoPath: "/videos/IMG_4212.mov",
    date: "2026-04-21",
  },
];

export function sortedVideos(): Video[] {
  return [...videos].sort((a, b) => b.date.localeCompare(a.date));
}
