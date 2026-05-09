import { PageHeader } from "@/components/PageHeader";
import { RecentUpdates } from "@/components/RecentUpdates";
import {
  embedUrl,
  featuredPlaylists,
  playlistUrl,
  snapshotPlaylists,
  type Playlist,
} from "@/lib/playlists";

export const metadata = {
  title: "Playlists",
};

export const revalidate = 1800;

function PlaylistEmbed({ playlist }: { playlist: Playlist }) {
  return (
    <article className="rounded-lg border border-line bg-white p-4 shadow-sm">
      <div className="mb-4">
        <h2 className="text-xl font-bold text-ink">{playlist.title}</h2>
        <p className="mt-2 leading-7 text-slate-700">{playlist.description}</p>
        <a
          aria-label={`Open ${playlist.title} on Spotify`}
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

      <RecentUpdates
        includeCode={false}
        includeLastFmTracks={false}
        includeSpotifyPlaylists
        intro="Songs recently added to the Spotify playlists shared on this page."
      />

      <section className="grid gap-5 py-8 lg:grid-cols-2">
        {featuredPlaylists.map((playlist) => (
          <PlaylistEmbed key={playlist.id} playlist={playlist} />
        ))}
      </section>

      <section className="border-t border-line py-8">
        <div className="mb-5 max-w-3xl">
          <h2 className="text-2xl font-bold text-ink">Short-window charts</h2>
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
                aria-label={`Open ${playlist.title} on Spotify`}
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
