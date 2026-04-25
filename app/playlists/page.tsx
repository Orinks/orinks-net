import { PageHeader } from "@/components/PageHeader";

export const metadata = {
  title: "Playlists",
};

type Playlist = {
  title: string;
  description: string;
  id: string;
  featured?: boolean;
};

const playlists: Playlist[] = [
  {
    title: "Underground Country",
    description: "A playlist for underground country discoveries and favorites.",
    id: "0WcVpFqMZoLyXWsQRu1is5",
    featured: true,
  },
  {
    title: "Musical Taste | The High School Years",
    description: "A LastFM-generated snapshot of my high school-era listening history.",
    id: "51EbaH9V4D4wdOANgUdrSA",
    featured: true,
  },
  {
    title: "College Years Top Tracks",
    description: "A LastFM-generated playlist covering my college-years top tracks.",
    id: "3BOXda0s6NOkJn7F3Hy8FJ",
    featured: true,
  },
  {
    title: "LastFM Top Tracks: 12 Months",
    description: "A longer-window LastFM playlist for the past year of listening.",
    id: "4IaGadLelNoV74kraVC2fg",
    featured: true,
  },
  {
    title: "My Country Favorites",
    description: "My personal country favorites playlist.",
    id: "04ZdQaaTb50pt8yI6gTKuB",
    featured: true,
  },
  {
    title: "Variety Favorites",
    description: "A personal favorites playlist with a wider mix of styles.",
    id: "0T4QH6Cb3FgvBnwyRAsReP",
    featured: true,
  },
  {
    title: "Favorite Covers",
    description: "My playlist for favorite cover versions.",
    id: "5Q4oUBSzxuTBFEheV1V6lL",
    featured: true,
  },
  {
    title: "Role Reversal",
    description: "My role reversal / vanilla femdom playlist.",
    id: "1Q2GN18r7TIGjvzlFdDVOx",
    featured: true,
  },
  {
    title: "LastFM Weekly Track Chart",
    description: "A weekly LastFM track chart snapshot.",
    id: "31BThqfdbj6F6fYsfTMc9A",
  },
  {
    title: "LastFM Top Tracks: 30 Days",
    description: "A short-window LastFM snapshot for the past 30 days.",
    id: "0b57pSlgQ07vgfOLFWYUw2",
  },
  {
    title: "LastFM Top Tracks: 7 Days",
    description: "A current-week LastFM snapshot for the past 7 days.",
    id: "4ze8nETp2sFK08RTTpkYmp",
  },
];

const featuredPlaylists = playlists.filter((playlist) => playlist.featured);
const snapshotPlaylists = playlists.filter((playlist) => !playlist.featured);

function playlistUrl(id: string) {
  return `https://open.spotify.com/playlist/${id}`;
}

function embedUrl(id: string) {
  return `https://open.spotify.com/embed/playlist/${id}?utm_source=generator`;
}

function PlaylistEmbed({ playlist }: { playlist: Playlist }) {
  return (
    <article className="rounded-lg border border-line bg-white p-4 shadow-sm">
      <div className="mb-4">
        <h2 className="text-xl font-bold text-ink">{playlist.title}</h2>
        <p className="mt-2 leading-7 text-slate-700">{playlist.description}</p>
        <a
          className="mt-3 inline-block font-semibold text-action hover:text-action-dark"
          href={playlistUrl(playlist.id)}
        >
          Open on Spotify
        </a>
      </div>
      <iframe
        aria-hidden="true"
        allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
        allowFullScreen
        className="h-[152px] w-full rounded-lg border-0"
        loading="lazy"
        src={embedUrl(playlist.id)}
        tabIndex={-1}
        title={`${playlist.title} Spotify playlist`}
      />
    </article>
  );
}

export default function PlaylistsPage() {
  return (
    <>
      <PageHeader
        title="Playlists"
        intro="Spotify playlists I want to share, including personal favorites, LastFM-generated listening snapshots, and selected collaborations."
      />

      <section className="grid gap-5 py-8 lg:grid-cols-2">
        {featuredPlaylists.map((playlist) => (
          <PlaylistEmbed key={playlist.id} playlist={playlist} />
        ))}
      </section>

      <section className="border-t border-line py-8">
        <div className="mb-5 max-w-3xl">
          <p className="text-sm font-semibold uppercase tracking-wide text-action">LastFM snapshots</p>
          <h2 className="mt-2 text-2xl font-bold text-ink">Short-window charts</h2>
          <p className="mt-2 leading-7 text-slate-700">
            These rotate more often, so they are linked separately instead of taking over the page with
            several similar embeds.
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          {snapshotPlaylists.map((playlist) => (
            <article className="rounded-lg border border-line bg-white p-5" key={playlist.id}>
              <h3 className="text-lg font-bold text-ink">{playlist.title}</h3>
              <p className="mt-2 leading-7 text-slate-700">{playlist.description}</p>
              <a
                className="mt-3 inline-block font-semibold text-action hover:text-action-dark"
                href={playlistUrl(playlist.id)}
              >
                Open on Spotify
              </a>
            </article>
          ))}
        </div>
      </section>
    </>
  );
}
