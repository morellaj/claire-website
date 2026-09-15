export interface Video {
  slug: string;
  title: string;
  description: string;
  youtubeId: string;
  date: string;
}

export const videos: Video[] = [

  {
    slug: "nah-brah",
    title: "NAH BRAH",
    description: "I got a suggestion from a friend for Tung Tung Sahur, so here I am!",
    youtubeId: "u7kqNj-Zvzc",
    date: "2026-09-14",
  },
  {
    slug: "fashion-fails",
    title: "fashion fails 😂",
    description: "fashion mishaps lol. this hilarious video will make your stomach hurt.",
    youtubeId: "FruFHdgy0Xo",
    date: "2026-09-13",
  },
  {
    slug: "diy-slow-rise-squishy",
    title: "DIY Slow Rise Squishy (With MAKEUP!) 🎨",
    description: "no squishy kit needed! i turned a plain chunk of memory foam into a slow rise squishy using just scissors and makeup 💄✂️",
    youtubeId: "kXeF_wYxvB0",
    date: "2026-09-13",
  },
  {
    slug: "berry-and-peanut",
    title: "Warning: Extreme Cuteness (Berry & Peanut) 🚨🐀",
    description: "they're small, they're squeaky, and they're VERY fancy. meet berry and peanut 🍓🥜",
    youtubeId: "yD56amEJDt0",
    date: "2026-09-13",
  },
  {
    slug: "fixing-my-panda-paradise-slime",
    title: "Fixing My Stiff Panda Paradise Slime 🐼",
    description: "my dope slimes panda paradise got super stiff, so i added lotion and a few other things to make it soft again ✨",
    youtubeId: "jrIS17YEECs",
    date: "2026-09-13",
  },
  {
    slug: "the-frappe-that-trusted-a-parrot",
    title: "The Frappe That Trusted a Parrot 🦜☕",
    description: "a frappe lost at sea begs a parrot for help... big mistake 💀",
    youtubeId: "1N1O9eFUOBI",
    date: "2026-09-13",
  },
  {
    slug: "im-a-cat",
    title: "IM A CAT",
    description: "you'll die laughing at this hilarious video",
    youtubeId: "7zKkKwA6Vmg",
    date: "2026-09-13",
  },
  {
    slug: "bingsu-bead-crunch-slime",
    title: "Bingsu bead crunch slime",
    description: "super crunchy slime with bingsu beads",
    youtubeId: "y9ilqnLm4C8",
    date: "2026-09-13",
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
