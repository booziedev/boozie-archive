import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Loader2, Pause, Pencil, Play, Plus, Radio, Trash2 } from 'lucide-react';

import { AddStationDialog } from '../components/AddStationDialog';
import { PageHeader } from '../components/PageHeader';
import { EmptyState } from '../components/states';
import { radio } from '../lib/api';
import { radioTrack } from '../lib/radio';
import { useAuth } from '../context/AuthContext';
import { usePlayer } from '../context/PlayerContext';
import type { Station } from '../lib/types';

/**
 * A coloured tile, so a station without a logo still looks like something.
 *
 * Artwork an admin uploaded wins, then whatever logo the directory supplied —
 * a remote URL that can rot, hence the fallback — and then the generated tile.
 */
function StationArt({ station, size = 'card' }: { station: Station; size?: 'card' | 'row' }) {
  const [failed, setFailed] = useState(false);
  // Same trick the library covers use: a stable hue derived from the name.
  const hue = [...station.name].reduce((total, char) => total + char.charCodeAt(0), 0) % 360;
  const art = station.coverUrl ?? station.faviconUrl;

  if (art && !failed) {
    return (
      <img
        src={art}
        alt=""
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className={`${size === 'card' ? 'aspect-square w-full' : 'h-12 w-12'} rounded-xl bg-white/5 ${
          // An uploaded cover is meant to fill the tile; a favicon is a logo
          // that would look wrong cropped, so it gets breathing room instead.
          station.coverUrl ? 'object-cover' : 'object-contain p-2'
        }`}
      />
    );
  }

  return (
    <span
      className={`flex items-center justify-center rounded-xl ${
        size === 'card' ? 'aspect-square w-full' : 'h-12 w-12'
      }`}
      style={{ background: `linear-gradient(135deg, hsl(${hue} 55% 32%), hsl(${(hue + 40) % 360} 45% 18%))` }}
    >
      <Radio size={size === 'card' ? 34 : 18} className="text-white/70" />
    </span>
  );
}

function StationCard({ station, isAdmin, onEdit }: { station: Station; isAdmin: boolean; onEdit: () => void }) {
  const { current, isPlaying, playTracks, toggle } = usePlayer();
  const queryClient = useQueryClient();
  const playing = current?.id === station.id;

  const remove = useMutation({
    mutationFn: () => radio.remove(station.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['radio'] }),
  });

  return (
    <div
      className={`surface surface-hover group relative flex flex-col gap-3 p-3 ${
        station.disabled ? 'opacity-50' : ''
      }`}
    >
      <button
        type="button"
        onClick={() => (playing ? toggle() : playTracks([radioTrack(station)], 0))}
        aria-label={playing && isPlaying ? `Pause ${station.name}` : `Play ${station.name}`}
        className="relative"
      >
        <StationArt station={station} />
        <span
          className={`absolute inset-0 flex items-center justify-center rounded-xl bg-black/50 transition-opacity duration-200 ${
            playing ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
          }`}
        >
          {playing && isPlaying ? (
            <Pause size={26} className="fill-current text-white" />
          ) : (
            <Play size={26} className="fill-current text-white" />
          )}
        </span>
      </button>

      <div className="min-w-0">
        <p className="flex items-center gap-1.5 truncate text-sm font-semibold text-zinc-100">
          {playing && isPlaying && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-red-400" />}
          {station.name}
        </p>
        <p className="truncate text-xs text-zinc-500">
          {[station.country, station.codec, station.bitrate ? `${station.bitrate}k` : null]
            .filter(Boolean)
            .join(' · ') || 'Live'}
        </p>
      </div>

      {station.tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {station.tags.slice(0, 3).map((tag) => (
            <span key={tag} className="rounded-md bg-white/5 px-1.5 py-0.5 text-[10px] text-zinc-500">
              {tag}
            </span>
          ))}
        </div>
      )}

      <div className="mt-auto flex items-center gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100 max-sm:opacity-100">
        {station.homepageUrl && (
          <a
            href={station.homepageUrl}
            target="_blank"
            rel="noreferrer noopener"
            title="Station website"
            aria-label={`${station.name} website`}
            className="icon-btn h-8 w-8"
          >
            <ExternalLink size={14} />
          </a>
        )}
        {isAdmin && (
          <>
            <button type="button" onClick={onEdit} aria-label={`Edit ${station.name}`} className="icon-btn h-8 w-8">
              <Pencil size={14} />
            </button>
            <button
              type="button"
              onClick={() => {
                if (window.confirm(`Remove ${station.name} from the station list?`)) remove.mutate();
              }}
              aria-label={`Remove ${station.name}`}
              className="icon-btn h-8 w-8 hover:text-red-400"
            >
              {remove.isPending ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Internet radio.
 *
 * The list is curated — an admin adds a station and everyone sees the same one.
 * Every station plays through this server rather than straight from the
 * broadcaster, which is what makes it work on an https page, through the audio
 * graph, without handing out anyone's IP address.
 */
export function RadioPage() {
  const { isAdmin } = useAuth();
  const [dialog, setDialog] = useState<{ station?: Station } | null>(null);

  const query = useQuery({ queryKey: ['radio'], queryFn: radio.list });
  const stations = query.data?.stations ?? [];

  return (
    <div>
      <PageHeader
        title="Radio"
        subtitle="Live stations, played through the archive."
        actions={
          isAdmin ? (
            <button type="button" onClick={() => setDialog({})} className="btn-primary">
              <Plus size={16} />
              Add station
            </button>
          ) : null
        }
      />

      {query.isLoading ? (
        <div className="card-grid">
          {Array.from({ length: 6 }, (_, index) => (
            <div key={index} className="aspect-[3/4] animate-pulse rounded-2xl bg-white/[0.04]" />
          ))}
        </div>
      ) : stations.length === 0 ? (
        <EmptyState
          icon={<Radio size={24} />}
          title="No stations yet"
          description={
            isAdmin
              ? 'Add one by name from the directory, or paste a stream URL.'
              : 'An admin has not added any stations yet.'
          }
          action={
            isAdmin ? (
              <button type="button" onClick={() => setDialog({})} className="btn-primary">
                <Plus size={16} />
                Add station
              </button>
            ) : null
          }
        />
      ) : (
        <div className="card-grid">
          {stations.map((station) => (
            <StationCard
              key={station.id}
              station={station}
              isAdmin={isAdmin}
              onEdit={() => setDialog({ station })}
            />
          ))}
        </div>
      )}

      {dialog && <AddStationDialog station={dialog.station} onClose={() => setDialog(null)} />}
    </div>
  );
}
