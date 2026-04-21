export interface Video {
  slug: string;
  title: string;
  description: string;
  youtubeId: string;
  date: string;
}

export const videos: Video[] = [
  {
    slug: "welcome",
    title: "Welcome to my channel!",
    description: "Hi! I'm Claire and this is my first video. I'm going to make slime and show you how to draw and lots of other fun stuff!",
    youtubeId: "dQw4w9WgXcQ",
    date: "2026-04-20",
  },
];

export function sortedVideos(): Video[] {
  return [...videos].sort((a, b) => b.date.localeCompare(a.date));
}
