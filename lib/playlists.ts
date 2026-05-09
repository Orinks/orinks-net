export type Playlist = {
  title: string;
  description: string;
  id: string;
  featured?: boolean;
  publishedAt: string;
};

export const playlists: Playlist[] = [
  {
    title: "Underground Country",
    description: "A playlist for underground country discoveries and favorites.",
    id: "0WcVpFqMZoLyXWsQRu1is5",
    featured: true,
    publishedAt: "2026-04-25T00:00:00.000Z",
  },
  {
    title: "Musical Taste | The High School Years",
    description: "A LastFM-generated snapshot of my high school-era listening history.",
    id: "51EbaH9V4D4wdOANgUdrSA",
    featured: true,
    publishedAt: "2026-04-25T00:00:00.000Z",
  },
  {
    title: "College Years Top Tracks",
    description: "A LastFM-generated playlist covering my college-years top tracks.",
    id: "3BOXda0s6NOkJn7F3Hy8FJ",
    featured: true,
    publishedAt: "2026-04-25T00:00:00.000Z",
  },
  {
    title: "LastFM Top Tracks: 12 Months",
    description: "A longer-window LastFM playlist for the past year of listening.",
    id: "4IaGadLelNoV74kraVC2fg",
    featured: true,
    publishedAt: "2026-04-25T00:00:00.000Z",
  },
  {
    title: "My Country Favorites",
    description: "My personal country favorites playlist.",
    id: "04ZdQaaTb50pt8yI6gTKuB",
    featured: true,
    publishedAt: "2026-04-25T00:00:00.000Z",
  },
  {
    title: "Variety Favorites",
    description: "A personal favorites playlist with a wider mix of styles.",
    id: "0T4QH6Cb3FgvBnwyRAsReP",
    featured: true,
    publishedAt: "2026-04-25T00:00:00.000Z",
  },
  {
    title: "Favorite Covers",
    description: "My playlist for favorite cover versions.",
    id: "5Q4oUBSzxuTBFEheV1V6lL",
    featured: true,
    publishedAt: "2026-04-25T00:00:00.000Z",
  },
  {
    title: "Role Reversal",
    description: "My role reversal / vanilla femdom playlist.",
    id: "1Q2GN18r7TIGjvzlFdDVOx",
    featured: true,
    publishedAt: "2026-04-25T00:00:00.000Z",
  },
  {
    title: "LastFM Weekly Track Chart",
    description: "A weekly LastFM track chart snapshot.",
    id: "31BThqfdbj6F6fYsfTMc9A",
    publishedAt: "2026-04-25T00:00:00.000Z",
  },
  {
    title: "LastFM Top Tracks: 30 Days",
    description: "A short-window LastFM snapshot for the past 30 days.",
    id: "0b57pSlgQ07vgfOLFWYUw2",
    publishedAt: "2026-04-25T00:00:00.000Z",
  },
  {
    title: "LastFM Top Tracks: 7 Days",
    description: "A current-week LastFM snapshot for the past 7 days.",
    id: "4ze8nETp2sFK08RTTpkYmp",
    publishedAt: "2026-04-25T00:00:00.000Z",
  },
];

export const featuredPlaylists = playlists.filter((playlist) => playlist.featured);
export const snapshotPlaylists = playlists.filter((playlist) => !playlist.featured);

export function playlistUrl(id: string) {
  return `https://open.spotify.com/playlist/${id}`;
}

export function embedUrl(id: string) {
  return `https://open.spotify.com/embed/playlist/${id}?utm_source=generator`;
}
