import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle2,
  Eye,
  Loader2,
  Palette,
  RotateCcw,
  Share,
  Smartphone,
  Sparkles,
  Trash2,
} from 'lucide-react';

import { PageHeader } from '../components/PageHeader';
import { presence } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { useIsIOS, useIsStandalone } from '../hooks/useIsStandalone';
import { GRADIENTS, hexToHsl, hslToHex, hexToRgb, type GradientId } from '../lib/theme';
import type { StatusVisibility } from '../lib/types';

/** Ready-made accents, so picking a look takes one tap. */
const PRESETS = ['#7c5cff', '#22d3ee', '#34d399', '#f59e0b', '#f43f5e', '#a855f7', '#38bdf8', '#e2e8f0'];

/** Appearance, installation and local maintenance. */
export function SettingsPage() {
  const { theme, setTheme, reset, isDefault } = useTheme();
  const { user } = useAuth();
  const standalone = useIsStandalone();
  const isIOS = useIsIOS();

  const accentHsl = hexToHsl(theme.accent);
  const [hexDraft, setHexDraft] = useState(theme.accent);

  /** Keeps saturation and lightness, spins the hue. */
  function setHue(hue: number) {
    const base = accentHsl ?? { h: hue, s: 100, l: 68 };
    const next = hslToHex({ ...base, h: hue });
    setTheme({ accent: next });
    setHexDraft(next);
  }

  function commitHex(value: string) {
    setHexDraft(value);
    const normalized = value.startsWith('#') ? value : `#${value}`;
    if (hexToRgb(normalized)) setTheme({ accent: normalized });
  }

  /** Wipes the offline cache so a stale app shell can be recovered from. */
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
      <PageHeader
        title="Settings"
        subtitle="Make it yours — colours, background and installation."
        actions={
          !isDefault ? (
            <button type="button" onClick={reset} className="btn-ghost">
              <RotateCcw size={15} />
              Reset theme
            </button>
          ) : null
        }
      />

      {/* ------------------------------ accent ---------------------------- */}
      <section className="surface space-y-5 p-5">
        <div className="flex items-center gap-2">
          <Palette size={17} className="text-accent-400" />
          <h2 className="text-sm font-semibold uppercase tracking-widest text-zinc-300">
            Accent colour
          </h2>
        </div>

        <div className="flex flex-wrap gap-2">
          {PRESETS.map((color) => (
            <button
              key={color}
              type="button"
              onClick={() => {
                setTheme({ accent: color });
                setHexDraft(color);
              }}
              aria-label={`Accent ${color}`}
              className={`h-9 w-9 rounded-full transition-transform hover:scale-110 ${
                theme.accent.toLowerCase() === color.toLowerCase()
                  ? 'ring-2 ring-white ring-offset-2 ring-offset-ink-850'
                  : ''
              }`}
              style={{ background: color }}
            />
          ))}
        </div>

        {/* Hue slider — the fastest way to sweep the whole palette. */}
        <label className="block">
          <span className="mb-2 flex items-center justify-between text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-600">
            Hue
            <span className="tabular-nums">{Math.round(accentHsl?.h ?? 0)}°</span>
          </span>
          <input
            type="range"
            min={0}
            max={360}
            step={1}
            value={Math.round(accentHsl?.h ?? 0)}
            onChange={(event) => setHue(Number(event.target.value))}
            aria-label="Accent hue"
            className="hue-range h-3 w-full cursor-pointer appearance-none rounded-full outline-none"
            style={{
              background:
                'linear-gradient(to right, #ff0000, #ffff00, #00ff00, #00ffff, #0000ff, #ff00ff, #ff0000)',
            }}
          />
        </label>

        {/* Exact value, for anyone who has a hex in mind. */}
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="color"
            value={hexToRgb(theme.accent) ? theme.accent : '#7c5cff'}
            onChange={(event) => commitHex(event.target.value)}
            aria-label="Pick an accent colour"
            className="h-10 w-14 cursor-pointer rounded-lg border border-white/10 bg-transparent p-1"
          />
          <label className="flex items-center gap-2">
            <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-600">Hex</span>
            <input
              type="text"
              value={hexDraft}
              onChange={(event) => commitHex(event.target.value)}
              onBlur={() => setHexDraft(theme.accent)}
              maxLength={7}
              spellCheck={false}
              aria-label="Accent hex code"
              className="w-28 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 font-mono text-sm uppercase text-zinc-100 focus:border-accent-500/50 focus:outline-none"
            />
          </label>

          <span className="ml-auto flex items-center gap-2">
            <span className="rounded-lg bg-accent-500 px-3 py-1.5 text-xs font-semibold text-white shadow-glow">
              Preview
            </span>
            <span className="pill pill-accent">Accent</span>
          </span>
        </div>
      </section>

      {/* ----------------------------- background -------------------------- */}
      <section className="surface space-y-5 p-5">
        <div className="flex items-center gap-2">
          <Sparkles size={17} className="text-accent-400" />
          <h2 className="text-sm font-semibold uppercase tracking-widest text-zinc-300">
            Background
          </h2>
        </div>

        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
          {GRADIENTS.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setTheme({ gradient: option.id })}
              className={`group overflow-hidden rounded-xl border text-left transition-colors ${
                theme.gradient === option.id
                  ? 'border-accent-500/60 bg-white/[0.06]'
                  : 'border-white/10 hover:border-white/20'
              }`}
            >
              <span
                aria-hidden
                className="block h-14 w-full"
                style={{ background: previewFor(option.id, theme.gradientFrom, theme.gradientTo) }}
              />
              <span className="block px-2.5 py-2">
                <span className="block text-xs font-semibold text-zinc-200">{option.name}</span>
                <span className="block truncate text-[10px] text-zinc-600">{option.description}</span>
              </span>
            </button>
          ))}
        </div>

        {theme.gradient !== 'none' && (
          <>
            <div className="flex flex-wrap items-center gap-5">
              <label className="flex items-center gap-2">
                <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-600">
                  From
                </span>
                <input
                  type="color"
                  value={theme.gradientFrom}
                  onChange={(event) => setTheme({ gradientFrom: event.target.value })}
                  aria-label="Gradient start colour"
                  className="h-9 w-12 cursor-pointer rounded-lg border border-white/10 bg-transparent p-1"
                />
              </label>
              <label className="flex items-center gap-2">
                <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-600">
                  To
                </span>
                <input
                  type="color"
                  value={theme.gradientTo}
                  onChange={(event) => setTheme({ gradientTo: event.target.value })}
                  aria-label="Gradient end colour"
                  className="h-9 w-12 cursor-pointer rounded-lg border border-white/10 bg-transparent p-1"
                />
              </label>
              <button
                type="button"
                onClick={() =>
                  setTheme({ gradientFrom: theme.gradientTo, gradientTo: theme.gradientFrom })
                }
                className="btn-ghost px-3 py-1.5 text-xs"
              >
                Swap
              </button>
              <button
                type="button"
                onClick={() => setTheme({ gradientFrom: theme.accent, gradientTo: theme.accent })}
                className="btn-ghost px-3 py-1.5 text-xs"
              >
                Match accent
              </button>
            </div>

            <label className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={theme.animate}
                onChange={(event) => setTheme({ animate: event.target.checked })}
                className="h-4 w-4 accent-accent-500"
              />
              <span className="text-sm text-zinc-300">Animate the background</span>
            </label>

            {theme.animate && (
              <label className="block">
                <span className="mb-2 flex items-center justify-between text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-600">
                  Speed
                  <span className="tabular-nums">{theme.gradientSpeed}s per cycle</span>
                </span>
                <input
                  type="range"
                  min={6}
                  max={90}
                  step={2}
                  // Inverted so dragging right feels faster.
                  value={96 - theme.gradientSpeed}
                  onChange={(event) => setTheme({ gradientSpeed: 96 - Number(event.target.value) })}
                  aria-label="Animation speed"
                  className="vault-range"
                  style={{
                    ['--range-progress' as string]: `${((96 - theme.gradientSpeed - 6) / 84) * 100}%`,
                  }}
                />
              </label>
            )}

            <p className="text-xs leading-relaxed text-zinc-600">
              The background respects your system's reduced-motion setting: with it on, the gradient
              is drawn as a still frame.
            </p>
          </>
        )}
      </section>

      {/* ------------------------------- privacy --------------------------- */}
      {user && <PrivacySection />}

      {/* ------------------------------- install --------------------------- */}
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

      {/* ----------------------------- maintenance ------------------------- */}
      <section className="surface space-y-3 p-5">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-zinc-300">Maintenance</h2>
        <p className="text-sm leading-relaxed text-zinc-500">
          Clears the offline app cache and reloads. Use this if the app looks stale after an update.
          Your account, favourites and theme are kept.
        </p>
        <button type="button" onClick={() => void clearCaches()} className="btn-ghost">
          <Trash2 size={15} />
          Clear offline cache & reload
        </button>
      </section>
    </div>
  );
}

/** A static thumbnail of each preset for the picker tiles. */
function previewFor(id: GradientId, from: string, to: string): string {
  switch (id) {
    case 'none':
      return '#0a0a10';
    case 'vault':
      return `radial-gradient(70% 120% at 15% 0%, ${from}, transparent 60%), radial-gradient(60% 110% at 85% 0%, ${to}, transparent 55%), #0a0a10`;
    case 'aurora':
      return `linear-gradient(115deg, #0a0a10 0%, ${from} 35%, #0a0a10 55%, ${to} 80%, #0a0a10 100%)`;
    case 'nebula':
      return `radial-gradient(60% 60% at 30% 25%, ${from}, transparent 70%), radial-gradient(55% 55% at 75% 70%, ${to}, transparent 70%), #0a0a10`;
    case 'ember':
      return `linear-gradient(0deg, ${from} 0%, ${to} 45%, #0a0a10 85%)`;
    case 'mesh':
      return `radial-gradient(40% 60% at 20% 25%, ${from}, transparent 70%), radial-gradient(35% 55% at 78% 30%, ${to}, transparent 70%), radial-gradient(45% 60% at 60% 85%, ${from}, transparent 72%), #0a0a10`;
    default:
      return '#0a0a10';
  }
}

/** The three audiences, reused by both controls below. */
const AUDIENCES: { value: StatusVisibility; label: string; description: string }[] = [
  {
    value: 'everyone',
    label: 'Everyone',
    description: 'Anyone with an account here.',
  },
  {
    value: 'friends',
    label: 'Friends only',
    description: 'Only people you have added as friends. This is the default.',
  },
  { value: 'nobody', label: 'Nobody', description: 'Nobody at all.' },
];

/** One audience picker: a labelled group of three radios. */
function AudienceChoice({
  name,
  title,
  hint,
  value,
  disabled,
  onChange,
}: {
  name: string;
  title: string;
  hint: string;
  value: StatusVisibility | undefined;
  disabled: boolean;
  onChange: (next: StatusVisibility) => void;
}) {
  return (
    <div>
      <p className="mb-1 text-sm font-medium text-zinc-200">{title}</p>
      <p className="mb-3 text-xs leading-relaxed text-zinc-500">{hint}</p>

      <div className="space-y-2">
        {AUDIENCES.map((option) => (
          <label
            key={option.value}
            className={`flex cursor-pointer gap-3 rounded-xl border p-3 transition-colors ${
              value === option.value
                ? 'border-accent-500/60 bg-white/[0.06]'
                : 'border-white/10 hover:border-white/20'
            }`}
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              disabled={disabled}
              onChange={() => onChange(option.value)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-accent-500"
            />
            <span className="min-w-0">
              <span className="block text-sm font-medium text-zinc-200">{option.label}</span>
              <span className="block text-xs leading-relaxed text-zinc-500">
                {option.description}
              </span>
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}

function PrivacySection() {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const privacyQuery = useQuery({ queryKey: ['presence', 'privacy'], queryFn: presence.privacy });

  const save = useMutation({
    mutationFn: presence.setPrivacy,
    onMutate: () => setError(null),
    onSuccess: (settings) => {
      queryClient.setQueryData(['presence', 'privacy'], settings);
      // Friends' views of you change too, so drop what they had cached.
      void queryClient.invalidateQueries({ queryKey: ['friends'] });
      void queryClient.invalidateQueries({ queryKey: ['profile'] });
    },
    onError: (saveError) =>
      setError(saveError instanceof Error ? saveError.message : 'Could not save that.'),
  });

  const settings = privacyQuery.data;
  const disabled = !settings || save.isPending;

  return (
    <section className="surface space-y-6 p-5">
      <div className="flex items-center gap-2">
        <Eye size={17} className="text-accent-400" />
        <h2 className="text-sm font-semibold uppercase tracking-widest text-zinc-300">Privacy</h2>
        {save.isPending && <Loader2 size={14} className="animate-spin text-zinc-500" />}
      </div>

      <AudienceChoice
        name="status-visibility"
        title="Who can see what you are listening to"
        hint="Your current track appears on your profile and next to your name in chat. It only
              shows while something is actually playing, and clears itself about a minute after you
              close the app."
        value={settings?.statusVisibility}
        disabled={disabled}
        onChange={(statusVisibility) => save.mutate({ statusVisibility })}
      />

      <div className="border-t border-white/5 pt-5">
        <AudienceChoice
          name="listen-along-visibility"
          title="Who can listen along with you"
          hint="They open your profile while you are playing something and press Listen together;
                their player then follows yours until they play something of their own."
          value={settings?.listenAlongVisibility}
          disabled={disabled}
          onChange={(listenAlongVisibility) => save.mutate({ listenAlongVisibility })}
        />
      </div>

      {privacyQuery.isError && (
        <p className="text-xs text-red-400">Could not load your privacy settings.</p>
      )}
      {error && <p className="text-xs text-red-400">{error}</p>}
    </section>
  );
}
