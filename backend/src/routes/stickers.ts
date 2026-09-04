import type { FastifyInstance, FastifyPluginAsync } from 'fastify';

import { config, isAllowedMediaUrl } from '../config.js';

/**
 * GIF and emoji search, proxied.
 *
 * The browser never talks to Giphy, Tenor or emoji.gg directly: the API keys
 * stay on the Pi, and the providers never see a visitor's IP or which archive
 * they are browsing. Results are filtered through the same media-host
 * allowlist that message attachments are checked against, so the picker can
 * only ever offer URLs the message endpoint will accept.
 */

interface GifResult {
  id: string;
  url: string;
  previewUrl: string;
  width?: number;
  height?: number;
  title?: string;
  provider: 'giphy' | 'tenor';
}

interface EmojiResult {
  id: string;
  name: string;
  url: string;
  provider: 'emoji.gg';
}

/** Small in-memory cache: the same searches repeat constantly. */
class TtlCache<T> {
  private entries = new Map<string, { value: T; expiresAt: number }>();

  constructor(private readonly ttlMs: number, private readonly max = 200) {}

  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: T) {
    if (this.entries.size >= this.max) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
    this.entries.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }
}

const gifCache = new TtlCache<GifResult[]>(10 * 60_000);
const emojiCache = new TtlCache<EmojiResult[]>(60 * 60_000);

/** Every upstream call is bounded so a slow provider can't tie up the Pi. */
async function fetchJson(url: string, timeoutMs = 6000): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`Provider replied ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function searchGiphy(query: string, limit: number): Promise<GifResult[]> {
  const endpoint = query
    ? `https://api.giphy.com/v1/gifs/search?api_key=${encodeURIComponent(config.giphyApiKey)}&q=${encodeURIComponent(query)}&limit=${limit}&rating=pg-13&bundle=messaging_non_clips`
    : `https://api.giphy.com/v1/gifs/trending?api_key=${encodeURIComponent(config.giphyApiKey)}&limit=${limit}&rating=pg-13&bundle=messaging_non_clips`;

  const payload = (await fetchJson(endpoint)) as {
    data?: {
      id: string;
      title?: string;
      images?: Record<string, { url?: string; width?: string; height?: string }>;
    }[];
  };

  return (payload.data ?? [])
    .map((item): GifResult | null => {
      const full = item.images?.downsized ?? item.images?.original;
      const preview = item.images?.fixed_width_small ?? item.images?.preview_gif ?? full;
      if (!full?.url || !preview?.url) return null;
      if (!isAllowedMediaUrl(full.url) || !isAllowedMediaUrl(preview.url)) return null;
      return {
        id: item.id,
        url: full.url,
        previewUrl: preview.url,
        width: full.width ? Number.parseInt(full.width, 10) : undefined,
        height: full.height ? Number.parseInt(full.height, 10) : undefined,
        title: item.title,
        provider: 'giphy',
      };
    })
    .filter((item): item is GifResult => item !== null);
}

async function searchTenor(query: string, limit: number): Promise<GifResult[]> {
  const base = query
    ? `https://tenor.googleapis.com/v2/search?q=${encodeURIComponent(query)}`
    : 'https://tenor.googleapis.com/v2/featured?';
  const endpoint = `${base}&key=${encodeURIComponent(config.tenorApiKey)}&limit=${limit}&contentfilter=medium&media_filter=gif,tinygif`;

  const payload = (await fetchJson(endpoint)) as {
    results?: {
      id: string;
      content_description?: string;
      media_formats?: Record<string, { url?: string; dims?: number[] }>;
    }[];
  };

  return (payload.results ?? [])
    .map((item): GifResult | null => {
      const full = item.media_formats?.gif;
      const preview = item.media_formats?.tinygif ?? full;
      if (!full?.url || !preview?.url) return null;
      if (!isAllowedMediaUrl(full.url) || !isAllowedMediaUrl(preview.url)) return null;
      return {
        id: item.id,
        url: full.url,
        previewUrl: preview.url,
        width: full.dims?.[0],
        height: full.dims?.[1],
        title: item.content_description,
        provider: 'tenor',
      };
    })
    .filter((item): item is GifResult => item !== null);
}

async function loadEmojiGg(): Promise<EmojiResult[]> {
  const payload = (await fetchJson('https://emoji.gg/api/', 10_000)) as
    | { id: number; title: string; image: string }[]
    | { emojis?: { id: number; title: string; image: string }[] };

  const list = Array.isArray(payload) ? payload : (payload.emojis ?? []);
  return list
    .filter((item) => isAllowedMediaUrl(item.image))
    .map((item) => ({
      id: String(item.id),
      name: item.title,
      url: item.image,
      provider: 'emoji.gg' as const,
    }));
}

export const stickerRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  /** Which tabs the picker should show. */
  app.get('/stickers/providers', async () => ({
    giphy: Boolean(config.giphyApiKey),
    tenor: Boolean(config.tenorApiKey),
    emojiGg: config.emojiGgEnabled,
  }));

  app.get('/stickers/gifs', async (request, reply) => {
    const { q, provider, limit } = request.query as {
      q?: string;
      provider?: string;
      limit?: string;
    };

    const query = (q ?? '').trim().slice(0, 100);
    const count = Math.min(Math.max(Number.parseInt(limit ?? '24', 10) || 24, 1), 40);
    const which = provider === 'tenor' ? 'tenor' : 'giphy';

    if (which === 'giphy' && !config.giphyApiKey) {
      return reply.code(503).send({ error: 'GIF search is not configured (no GIPHY_API_KEY).' });
    }
    if (which === 'tenor' && !config.tenorApiKey) {
      return reply.code(503).send({ error: 'GIF search is not configured (no TENOR_API_KEY).' });
    }

    const cacheKey = `${which}:${count}:${query}`;
    const cached = gifCache.get(cacheKey);
    if (cached) return { results: cached };

    try {
      const results = which === 'tenor' ? await searchTenor(query, count) : await searchGiphy(query, count);
      gifCache.set(cacheKey, results);
      return { results };
    } catch (error) {
      request.log.warn(`GIF search failed: ${(error as Error).message}`);
      return reply.code(502).send({ error: 'The GIF provider is not responding.' });
    }
  });

  app.get('/stickers/emojis', async (request, reply) => {
    if (!config.emojiGgEnabled) {
      return reply.code(503).send({ error: 'Emoji search is disabled.' });
    }

    const { q } = request.query as { q?: string };
    const query = (q ?? '').trim().toLowerCase().slice(0, 60);

    let all = emojiCache.get('all');
    if (!all) {
      try {
        all = await loadEmojiGg();
        emojiCache.set('all', all);
      } catch (error) {
        request.log.warn(`emoji.gg fetch failed: ${(error as Error).message}`);
        return reply.code(502).send({ error: 'emoji.gg is not responding.' });
      }
    }

    const results = (query ? all.filter((item) => item.name.toLowerCase().includes(query)) : all).slice(
      0,
      60,
    );
    return { results };
  });
};
