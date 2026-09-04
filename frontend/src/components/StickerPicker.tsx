import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Search, Smile, X } from 'lucide-react';

import { stickers } from '../lib/api';
import { useDebounced } from '../hooks/useDebounced';
import type { Attachment } from '../lib/types';

type Tab = 'giphy' | 'tenor' | 'emoji';

/**
 * GIF and emoji picker for the message composer.
 *
 * Searches go through the archive's own API rather than to Giphy/Tenor/emoji.gg
 * directly: the API keys stay on the Pi, and the providers never learn who is
 * browsing. Everything offered here is already on the server's media-host
 * allowlist, so anything picked will be accepted when it is sent.
 */
export function StickerPicker({
  onPick,
  onClose,
}: {
  onPick: (attachment: Attachment) => void;
  onClose: () => void;
}) {
  const providers = useQuery({ queryKey: ['stickers', 'providers'], queryFn: stickers.providers });
  const [tab, setTab] = useState<Tab>('giphy');
  const [query, setQuery] = useState('');
  const debounced = useDebounced(query, 350);

  // Land on whichever tab is actually configured.
  useEffect(() => {
    if (!providers.data) return;
    if (providers.data.giphy) setTab('giphy');
    else if (providers.data.tenor) setTab('tenor');
    else if (providers.data.emojiGg) setTab('emoji');
  }, [providers.data]);

  const gifQuery = useQuery({
    queryKey: ['stickers', 'gifs', tab, debounced],
    queryFn: () => stickers.gifs(debounced, tab === 'tenor' ? 'tenor' : 'giphy'),
    enabled: tab === 'giphy' || tab === 'tenor',
    retry: false,
  });

  const emojiQuery = useQuery({
    queryKey: ['stickers', 'emojis', debounced],
    queryFn: () => stickers.emojis(debounced),
    enabled: tab === 'emoji',
    retry: false,
  });

  const available = providers.data;
  const anyProvider = available && (available.giphy || available.tenor || available.emojiGg);

  const tabs: { key: Tab; label: string; enabled: boolean }[] = [
    { key: 'giphy', label: 'Giphy', enabled: Boolean(available?.giphy) },
    { key: 'tenor', label: 'Tenor', enabled: Boolean(available?.tenor) },
    { key: 'emoji', label: 'emoji.gg', enabled: Boolean(available?.emojiGg) },
  ];

  const loading = tab === 'emoji' ? emojiQuery.isLoading : gifQuery.isLoading;
  const error = tab === 'emoji' ? emojiQuery.error : gifQuery.error;

  return (
    <div className="absolute bottom-full right-0 z-30 mb-2 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-white/10 bg-ink-900/[0.98] shadow-2xl backdrop-blur-2xl animate-scale-in">
      <div className="flex items-center gap-1 border-b border-white/5 p-2">
        {tabs.map((entry) => (
          <button
            key={entry.key}
            type="button"
            disabled={!entry.enabled}
            onClick={() => setTab(entry.key)}
            className={`flex-1 rounded-lg px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider transition-colors disabled:opacity-25 ${
              tab === entry.key ? 'bg-white/10 text-white' : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            {entry.label}
          </button>
        ))}
        <button type="button" onClick={onClose} aria-label="Close picker" className="icon-btn h-8 w-8">
          <X size={15} />
        </button>
      </div>

      {!anyProvider && !providers.isLoading ? (
        <p className="px-4 py-8 text-center text-xs leading-relaxed text-zinc-500">
          GIF search isn't configured. Add <code className="text-zinc-400">GIPHY_API_KEY</code> or{' '}
          <code className="text-zinc-400">TENOR_API_KEY</code> to <code>backend/.env</code> and
          restart.
        </p>
      ) : (
        <>
          <div className="relative p-2">
            <Search size={14} className="pointer-events-none absolute left-4.5 top-4.5 text-zinc-600" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={tab === 'emoji' ? 'Search emoji…' : 'Search GIFs…'}
              aria-label="Search"
              className="w-full rounded-xl border border-white/10 bg-white/[0.04] py-2 pl-8 pr-3 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-accent-500/50 focus:outline-none"
            />
          </div>

          <div className="max-h-72 overflow-y-auto overscroll-contain p-2 pt-0">
            {loading ? (
              <div className="flex h-32 items-center justify-center">
                <Loader2 size={20} className="animate-spin text-zinc-600" />
              </div>
            ) : error ? (
              <p className="px-3 py-8 text-center text-xs text-red-400">
                {error instanceof Error ? error.message : 'Search failed.'}
              </p>
            ) : tab === 'emoji' ? (
              <div className="grid grid-cols-6 gap-1.5">
                {(emojiQuery.data?.results ?? []).map((emoji) => (
                  <button
                    key={emoji.id}
                    type="button"
                    title={emoji.name}
                    onClick={() =>
                      onPick({
                        kind: 'emoji',
                        url: emoji.url,
                        name: emoji.name,
                        provider: emoji.provider,
                      })
                    }
                    className="flex aspect-square items-center justify-center rounded-lg p-1 transition-colors hover:bg-white/10"
                  >
                    <img
                      src={emoji.url}
                      alt={emoji.name}
                      loading="lazy"
                      referrerPolicy="no-referrer"
                      className="max-h-full max-w-full"
                    />
                  </button>
                ))}
              </div>
            ) : (
              <div className="columns-2 gap-1.5 [column-fill:_balance]">
                {(gifQuery.data?.results ?? []).map((gif) => (
                  <button
                    key={gif.id}
                    type="button"
                    title={gif.title}
                    onClick={() =>
                      onPick({
                        kind: 'gif',
                        url: gif.url,
                        previewUrl: gif.previewUrl,
                        width: gif.width,
                        height: gif.height,
                        provider: gif.provider,
                        title: gif.title,
                      })
                    }
                    className="mb-1.5 block w-full overflow-hidden rounded-lg transition-transform hover:scale-[0.98]"
                  >
                    <img
                      src={gif.previewUrl}
                      alt={gif.title ?? ''}
                      loading="lazy"
                      referrerPolicy="no-referrer"
                      className="w-full"
                    />
                  </button>
                ))}
              </div>
            )}
          </div>

          <p className="flex items-center gap-1.5 border-t border-white/5 px-3 py-1.5 text-[10px] text-zinc-600">
            <Smile size={11} />
            {tab === 'emoji' ? 'Powered by emoji.gg' : tab === 'tenor' ? 'Powered by Tenor' : 'Powered by GIPHY'}
          </p>
        </>
      )}
    </div>
  );
}
