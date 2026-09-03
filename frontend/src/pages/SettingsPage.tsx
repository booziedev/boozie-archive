import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Loader2, Plug, RefreshCw, Share, Smartphone, Trash2, XCircle } from 'lucide-react';

import { PageHeader } from '../components/PageHeader';
import {
  getApiBaseUrl,
  getConfiguredBaseUrl,
  hasApiOverride,
  setApiBaseUrl,
  normalizeBase,
} from '../lib/config';
import { formatBytes, formatDate, formatNumber, formatRuntime } from '../lib/format';
import { useStats } from '../hooks/useLibrary';
import { useIsIOS, useIsStandalone } from '../hooks/useIsStandalone';

type TestState = { status: 'idle' | 'testing' | 'ok' | 'fail'; message?: string };

/** Connection settings, library diagnostics and PWA install help. */
export function SettingsPage() {
  const [value, setValue] = useState(getApiBaseUrl());
  const [test, setTest] = useState<TestState>({ status: 'idle' });
  const queryClient = useQueryClient();
  const { data: stats } = useStats();
  const standalone = useIsStandalone();
  const isIOS = useIsIOS();

  /** Verifies the entered URL before it becomes the app's API base. */
  async function testConnection() {
    setTest({ status: 'testing' });
    try {
      const base = normalizeBase(value);
      const response = await fetch(`${base}/api/health`, { headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error(`Server replied ${response.status}`);
      const body = (await response.json()) as { status: string; indexed: boolean };
      setTest({
        status: 'ok',
        message: body.indexed ? 'Connected — library indexed.' : 'Connected — the library is still indexing.',
      });
    } catch (error) {
      setTest({
        status: 'fail',
        message:
          error instanceof Error
            ? `${error.message}. Check the URL, that the backend is running, and that CORS allows this origin.`
            : 'Connection failed.',
      });
    }
  }

  function save() {
    setApiBaseUrl(value);
    queryClient.clear();
    setTest({ status: 'ok', message: 'Saved. Reloading data from the new server…' });
  }

  function resetToBuildValue() {
    setApiBaseUrl('');
    setValue(getConfiguredBaseUrl());
    queryClient.clear();
    setTest({ status: 'idle' });
  }

  /** Wipes the offline caches so a stale app shell can be recovered from. */
  async function clearCaches() {
    try {
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((key) => caches.delete(key)));
      }
      if ('serviceWorker' in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(registrations.map((registration) => registration.unregister()));
      }
    } finally {
      window.location.reload();
    }
  }

  return (
    <div className="max-w-3xl space-y-8">
      <PageHeader title="Settings" subtitle="Connection, diagnostics and installation." />

      {/* ------------------------- API connection ------------------------- */}
      <section className="surface space-y-4 p-5">
        <div className="flex items-center gap-2">
          <Plug size={17} className="text-accent-400" />
          <h2 className="text-sm font-semibold uppercase tracking-widest text-zinc-300">
            Archive server
          </h2>
        </div>

        <p className="text-sm leading-relaxed text-zinc-500">
          The public HTTPS address of the backend running on the Pi (your Cloudflare Tunnel or
          Tailscale Funnel URL). Leave it empty to use the same origin as this page.
        </p>

        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            type="url"
            inputMode="url"
            value={value}
            onChange={(event) => {
              setValue(event.target.value);
              setTest({ status: 'idle' });
            }}
            placeholder="https://music-api.example.com"
            aria-label="API base URL"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            className="flex-1 rounded-xl border border-white/10 bg-white/[0.04] px-3.5 py-2.5 font-mono text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-accent-500/50 focus:outline-none"
          />
          <button type="button" onClick={testConnection} className="btn-ghost">
            {test.status === 'testing' ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
            Test
          </button>
          <button type="button" onClick={save} className="btn-primary">
            Save
          </button>
        </div>

        {test.status === 'ok' && (
          <p className="flex items-center gap-2 text-sm text-emerald-400">
            <CheckCircle2 size={15} />
            {test.message}
          </p>
        )}
        {test.status === 'fail' && (
          <p className="flex items-start gap-2 text-sm text-red-400">
            <XCircle size={15} className="mt-0.5 shrink-0" />
            {test.message}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-3 border-t border-white/5 pt-3 text-xs text-zinc-600">
          <span>
            Build default:{' '}
            <code className="font-mono text-zinc-500">{getConfiguredBaseUrl() || 'same origin'}</code>
          </span>
          {hasApiOverride() && (
            <button type="button" onClick={resetToBuildValue} className="text-accent-400 hover:underline">
              Reset to build default
            </button>
          )}
        </div>
      </section>

      {/* --------------------------- library ------------------------------ */}
      <section className="surface space-y-3 p-5">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-zinc-300">Library</h2>
        {stats ? (
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
            <Row label="Artists" value={formatNumber(stats.artists)} />
            <Row label="Albums" value={formatNumber(stats.albums)} />
            <Row label="Tracks" value={formatNumber(stats.tracks)} />
            <Row label="Total size" value={formatBytes(stats.size)} />
            <Row label="Runtime" value={formatRuntime(stats.duration)} />
            <Row label="Genres" value={formatNumber(stats.genres)} />
            <Row label="Last scan" value={formatDate(stats.scannedAt)} />
            <Row label="Status" value={stats.scanning ? 'Scanning…' : 'Idle'} />
            <Row
              label="Formats"
              value={stats.formats.map((format) => format.ext.toUpperCase()).join(', ') || '—'}
            />
          </dl>
        ) : (
          <p className="text-sm text-zinc-500">No connection to the archive server.</p>
        )}
      </section>

      {/* ----------------------------- install ---------------------------- */}
      <section className="surface space-y-3 p-5">
        <div className="flex items-center gap-2">
          <Smartphone size={17} className="text-accent-400" />
          <h2 className="text-sm font-semibold uppercase tracking-widest text-zinc-300">
            Install on your phone
          </h2>
        </div>

        {standalone ? (
          <p className="flex items-center gap-2 text-sm text-emerald-400">
            <CheckCircle2 size={15} />
            Running as an installed app.
          </p>
        ) : isIOS ? (
          <ol className="space-y-1.5 text-sm leading-relaxed text-zinc-400">
            <li>
              1. Open this page in <strong className="text-zinc-200">Safari</strong> (not Chrome).
            </li>
            <li className="flex items-center gap-1.5">
              2. Tap the Share button
              <Share size={14} className="inline text-zinc-300" />
            </li>
            <li>
              3. Choose <strong className="text-zinc-200">Add to Home Screen</strong>, then Add.
            </li>
            <li className="pt-1 text-zinc-500">
              The app then runs full-screen with lock-screen playback controls.
            </li>
          </ol>
        ) : (
          <p className="text-sm leading-relaxed text-zinc-400">
            Use your browser's “Install app” option (in the address bar or the ⋮ menu) to add the
            archive to your home screen or desktop.
          </p>
        )}
      </section>

      {/* --------------------------- maintenance -------------------------- */}
      <section className="surface space-y-3 p-5">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-zinc-300">Maintenance</h2>
        <p className="text-sm leading-relaxed text-zinc-500">
          Clears the offline app cache and reloads. Use this after a deploy if the app looks stale.
          Favourites are kept.
        </p>
        <button type="button" onClick={() => void clearCaches()} className="btn-ghost">
          <Trash2 size={15} />
          Clear offline cache & reload
        </button>
      </section>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-600">{label}</dt>
      <dd className="mt-0.5 truncate text-zinc-300" title={value}>
        {value}
      </dd>
    </div>
  );
}
