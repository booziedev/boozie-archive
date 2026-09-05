import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Check,
  Clock,
  Lightbulb,
  Loader2,
  Music2,
  Upload,
  X,
} from 'lucide-react';

import { PageHeader, SectionHeader } from '../components/PageHeader';
import { EmptyState, ErrorState } from '../components/states';
import { suggestions as api } from '../lib/api';
import { formatBytes, formatDate } from '../lib/format';
import type { Suggestion, SuggestionStatus } from '../lib/types';

const STATUS_STYLES: Record<SuggestionStatus, string> = {
  pending: 'border-amber-400/30 bg-amber-400/10 text-amber-300',
  accepted: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300',
  denied: 'border-rose-400/30 bg-rose-400/10 text-rose-300',
};

/**
 * Where members propose things: a feature idea, or an audio file for the
 * collection. Uploads are held for review — nothing reaches the library until
 * an admin accepts it.
 */
export function SuggestionsPage() {
  const queryClient = useQueryClient();
  const mine = useQuery({ queryKey: ['suggestions', 'mine'], queryFn: api.mine });

  const [idea, setIdea] = useState('');
  const [note, setNote] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const accepts = mine.data?.accepts ?? ['mp3', 'flac', 'wav', 'm4a'];
  const maxBytes = mine.data?.maxBytes ?? 150 * 1024 * 1024;
  const acceptAttr = accepts.map((ext) => `.${ext}`).join(',');

  function refresh() {
    return queryClient.invalidateQueries({ queryKey: ['suggestions'] });
  }
  function onError(actionError: unknown) {
    setError(actionError instanceof Error ? actionError.message : 'That did not go through.');
    setSent(null);
  }

  const sendIdea = useMutation({
    mutationFn: () => api.create(idea),
    onSuccess: async () => {
      setIdea('');
      setError(null);
      setSent('Thanks — your suggestion is with the admins.');
      await refresh();
    },
    onError,
  });

  const sendFile = useMutation({
    mutationFn: () => api.upload(file!, note),
    onSuccess: async () => {
      setFile(null);
      setNote('');
      setError(null);
      setSent('Uploaded. An admin will listen to it before it joins the archive.');
      if (fileInput.current) fileInput.current.value = '';
      await refresh();
    },
    onError,
  });

  /** Client-side checks so an obvious mistake doesn't cost a long upload. */
  function pickFile(event: React.ChangeEvent<HTMLInputElement>) {
    const chosen = event.target.files?.[0] ?? null;
    setSent(null);
    if (!chosen) {
      setFile(null);
      return;
    }

    const ext = chosen.name.split('.').pop()?.toLowerCase() ?? '';
    if (!accepts.includes(ext)) {
      setError(`Only ${accepts.map((e) => `.${e}`).join(', ')} files can be uploaded.`);
      setFile(null);
      event.target.value = '';
      return;
    }
    if (chosen.size > maxBytes) {
      setError(`That file is ${formatBytes(chosen.size)} — the limit is ${formatBytes(maxBytes)}.`);
      setFile(null);
      event.target.value = '';
      return;
    }

    setError(null);
    setFile(chosen);
  }

  return (
    <div className="max-w-3xl space-y-8">
      <PageHeader
        title="Suggestions"
        subtitle="Ask for a feature, or send music you think belongs in the archive."
      />

      {error && (
        <p className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-2.5 text-sm text-red-300">
          {error}
        </p>
      )}
      {sent && (
        <p className="flex items-center gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-2.5 text-sm text-emerald-300">
          <Check size={15} />
          {sent}
        </p>
      )}

      {/* ------------------------------ an idea --------------------------- */}
      <section className="surface space-y-3 p-5">
        <div className="flex items-center gap-2">
          <Lightbulb size={17} className="text-accent-400" />
          <h2 className="text-sm font-semibold uppercase tracking-widest text-zinc-300">
            Suggest a feature
          </h2>
        </div>

        <textarea
          value={idea}
          onChange={(event) => setIdea(event.target.value.slice(0, 2000))}
          rows={3}
          placeholder="Something that would make the archive better…"
          className="w-full resize-none rounded-xl border border-white/10 bg-white/[0.04] px-3.5 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-accent-500/50 focus:outline-none"
        />

        <div className="flex items-center justify-between gap-3">
          <span className="text-xs tabular-nums text-zinc-600">{idea.length}/2000</span>
          <button
            type="button"
            onClick={() => sendIdea.mutate()}
            disabled={idea.trim().length < 4 || sendIdea.isPending}
            className="btn-primary"
          >
            {sendIdea.isPending && <Loader2 size={15} className="animate-spin" />}
            Submit
          </button>
        </div>
      </section>

      {/* ------------------------------ a track --------------------------- */}
      <section className="surface space-y-3 p-5">
        <div className="flex items-center gap-2">
          <Music2 size={17} className="text-accent-400" />
          <h2 className="text-sm font-semibold uppercase tracking-widest text-zinc-300">
            Suggest a track
          </h2>
        </div>

        <p className="text-xs leading-relaxed text-zinc-500">
          {accepts.map((ext) => `.${ext}`).join(', ')} only, up to {formatBytes(maxBytes)}. Uploads
          are held for review — an admin listens before anything joins the collection.
        </p>

        <input
          ref={fileInput}
          type="file"
          accept={acceptAttr}
          onChange={pickFile}
          className="block w-full cursor-pointer rounded-xl border border-white/10 bg-white/[0.04] p-2.5 text-sm text-zinc-400 file:mr-3 file:cursor-pointer file:rounded-lg file:border-0 file:bg-accent-500 file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-white hover:file:bg-accent-400"
        />

        {file && (
          <p className="flex items-center gap-2 text-xs text-zinc-400">
            <Music2 size={13} className="text-accent-400" />
            {file.name}
            <span className="text-zinc-600">{formatBytes(file.size)}</span>
          </p>
        )}

        <input
          type="text"
          value={note}
          onChange={(event) => setNote(event.target.value.slice(0, 2000))}
          placeholder="Artist, album, why it belongs… (optional)"
          className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-3.5 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-accent-500/50 focus:outline-none"
        />

        <button
          type="button"
          onClick={() => sendFile.mutate()}
          disabled={!file || sendFile.isPending}
          className="btn-primary"
        >
          {sendFile.isPending ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
          {sendFile.isPending ? 'Uploading…' : 'Upload for review'}
        </button>
      </section>

      {/* ---------------------------- what I sent ------------------------- */}
      <section>
        <SectionHeader title="Your suggestions" />
        {mine.isError ? (
          <ErrorState error={mine.error} onRetry={() => mine.refetch()} />
        ) : mine.isLoading ? (
          <div className="surface p-6 text-sm text-zinc-500">Loading…</div>
        ) : (mine.data?.suggestions.length ?? 0) === 0 ? (
          <EmptyState
            icon={<Lightbulb size={24} />}
            title="Nothing suggested yet"
            description="Anything you send shows up here with its review status."
          />
        ) : (
          <div className="surface divide-y divide-white/[0.04]">
            {mine.data!.suggestions.map((suggestion) => (
              <SuggestionRow key={suggestion.id} suggestion={suggestion} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function SuggestionRow({ suggestion }: { suggestion: Suggestion }) {
  const Icon = suggestion.kind === 'track' ? Music2 : Lightbulb;
  const StatusIcon =
    suggestion.status === 'accepted' ? Check : suggestion.status === 'denied' ? X : Clock;

  return (
    <div className="flex items-start gap-3 p-4">
      <Icon size={16} className="mt-0.5 shrink-0 text-zinc-600" />

      <div className="min-w-0 flex-1">
        {suggestion.fileName && (
          <p className="truncate text-sm font-medium text-zinc-100">{suggestion.fileName}</p>
        )}
        {suggestion.body && (
          <p className="whitespace-pre-wrap break-words text-sm text-zinc-300">{suggestion.body}</p>
        )}
        <p className="mt-1 text-xs text-zinc-600">
          {formatDate(suggestion.createdAt)}
          {suggestion.bytes ? ` · ${formatBytes(suggestion.bytes)}` : ''}
        </p>
        {suggestion.reviewNote && (
          <p className="mt-1.5 rounded-lg border border-white/5 bg-white/[0.03] px-2.5 py-1.5 text-xs text-zinc-400">
            <span className="text-zinc-500">Admin:</span> {suggestion.reviewNote}
          </p>
        )}
      </div>

      <span
        className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${STATUS_STYLES[suggestion.status]}`}
      >
        <StatusIcon size={10} />
        {suggestion.status}
      </span>
    </div>
  );
}
