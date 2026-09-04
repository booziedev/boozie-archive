import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Check,
  Copy,
  Link2,
  Loader2,
  Plus,
  ShieldCheck,
  Ticket,
  Trash2,
  ToggleLeft,
  ToggleRight,
  Users,
} from 'lucide-react';

import { PageHeader, SectionHeader } from '../components/PageHeader';
import { EmptyState, ErrorState } from '../components/states';
import { admin } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { formatDate } from '../lib/format';
import type { AdminAccountUser, Invite, InviteStatus } from '../lib/types';

/** Discord's own invite presets, which is the interaction being copied here. */
const EXPIRY_OPTIONS: { label: string; seconds: number | null }[] = [
  { label: '30 minutes', seconds: 30 * 60 },
  { label: '1 hour', seconds: 60 * 60 },
  { label: '6 hours', seconds: 6 * 60 * 60 },
  { label: '12 hours', seconds: 12 * 60 * 60 },
  { label: '1 day', seconds: 24 * 60 * 60 },
  { label: '7 days', seconds: 7 * 24 * 60 * 60 },
  { label: '30 days', seconds: 30 * 24 * 60 * 60 },
  { label: 'Never', seconds: null },
];

const USES_OPTIONS: { label: string; value: number | null }[] = [
  { label: '1 use', value: 1 },
  { label: '5 uses', value: 5 },
  { label: '10 uses', value: 10 },
  { label: '25 uses', value: 25 },
  { label: '50 uses', value: 50 },
  { label: '100 uses', value: 100 },
  { label: 'No limit', value: null },
];

const STATUS_STYLES: Record<InviteStatus, string> = {
  active: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300',
  disabled: 'border-zinc-500/30 bg-zinc-500/10 text-zinc-400',
  expired: 'border-amber-400/30 bg-amber-400/10 text-amber-300',
  exhausted: 'border-rose-400/30 bg-rose-400/10 text-rose-300',
};

/** "6h 12m", "45s", or "Expired" — recomputed every second by the caller. */
function countdown(expiresAt: string | null, now: number): string {
  if (!expiresAt) return 'Never expires';
  const remaining = new Date(expiresAt).getTime() - now;
  if (remaining <= 0) return 'Expired';

  const seconds = Math.floor(remaining / 1000);
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${secs}s`;
  return `${secs}s`;
}

/** Copy-to-clipboard button that confirms itself for a moment. */
function CopyButton({ value, label, icon }: { value: string; label: string; icon?: React.ReactNode }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // Safari without clipboard permission: fall back to a temporary input.
      const input = document.createElement('input');
      input.value = value;
      document.body.append(input);
      input.select();
      document.execCommand('copy');
      input.remove();
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  return (
    <button
      type="button"
      onClick={copy}
      title={label}
      aria-label={label}
      className="icon-btn h-8 w-8"
    >
      {copied ? <Check size={14} className="text-emerald-400" /> : (icon ?? <Copy size={14} />)}
    </button>
  );
}

/** Invite management and user administration. Admins only. */
export function AdminPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [now, setNow] = useState(() => Date.now());

  // Drives the live expiry countdowns.
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const invitesQuery = useQuery({ queryKey: ['admin', 'invites'], queryFn: admin.invites });
  const usersQuery = useQuery({ queryKey: ['admin', 'users'], queryFn: admin.users });

  const [label, setLabel] = useState('');
  const [expiry, setExpiry] = useState<number | null>(24 * 60 * 60);
  const [maxUses, setMaxUses] = useState<number | null>(null);
  const [lastCreated, setLastCreated] = useState<Invite | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  function refreshInvites() {
    return queryClient.invalidateQueries({ queryKey: ['admin', 'invites'] });
  }
  function refreshUsers() {
    return queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
  }
  function onError(error: unknown) {
    setActionError(error instanceof Error ? error.message : 'That action failed.');
  }

  const createMutation = useMutation({
    mutationFn: () => admin.createInvite({ label: label.trim() || undefined, expiresInSeconds: expiry, maxUses }),
    onSuccess: async (result) => {
      setLastCreated(result.invite);
      setLabel('');
      setActionError(null);
      await refreshInvites();
    },
    onError,
  });

  const toggleInvite = useMutation({
    mutationFn: ({ id, disabled }: { id: string; disabled: boolean }) =>
      admin.setInviteDisabled(id, disabled),
    onSuccess: async () => {
      setActionError(null);
      await refreshInvites();
    },
    onError,
  });

  const removeInvite = useMutation({
    mutationFn: (id: string) => admin.deleteInvite(id),
    onSuccess: async () => {
      setActionError(null);
      await refreshInvites();
    },
    onError,
  });

  const updateUser = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: { role?: 'user' | 'admin'; disabled?: boolean } }) =>
      admin.updateUser(id, patch),
    onSuccess: async () => {
      setActionError(null);
      await refreshUsers();
    },
    onError,
  });

  const removeUser = useMutation({
    mutationFn: (id: string) => admin.deleteUser(id),
    onSuccess: async () => {
      setActionError(null);
      await Promise.all([refreshUsers(), refreshInvites()]);
    },
    onError,
  });

  const invites = invitesQuery.data?.invites ?? [];
  const users = usersQuery.data?.users ?? [];
  const activeCount = invites.filter((invite) => invite.status === 'active').length;

  function inviteLink(code: string): string {
    return `${window.location.origin}/invite/${code}`;
  }

  return (
    <div className="space-y-10">
      <PageHeader
        title="Admin"
        subtitle="Invite codes and accounts for the archive."
        actions={
          <span className="pill pill-accent">
            <ShieldCheck size={12} />
            {user?.username}
          </span>
        }
      />

      {actionError && (
        <p className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {actionError}
        </p>
      )}

      {/* ------------------------------ create ---------------------------- */}
      <section className="surface p-5">
        <SectionHeader title="Create an invite" />

        <div className="grid gap-3 sm:grid-cols-3">
          <label className="block">
            <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-600">
              Label (optional)
            </span>
            <input
              type="text"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              placeholder="e.g. discord friends"
              className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-accent-500/50 focus:outline-none"
            />
          </label>

          <label className="block">
            <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-600">
              Expire after
            </span>
            <select
              value={expiry === null ? 'never' : String(expiry)}
              onChange={(event) =>
                setExpiry(event.target.value === 'never' ? null : Number(event.target.value))
              }
              className="w-full rounded-xl border border-white/10 bg-ink-850 px-3 py-2 text-sm text-zinc-200 focus:border-accent-500/50 focus:outline-none"
            >
              {EXPIRY_OPTIONS.map((option) => (
                <option key={option.label} value={option.seconds === null ? 'never' : option.seconds}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-600">
              Max number of uses
            </span>
            <select
              value={maxUses === null ? 'unlimited' : String(maxUses)}
              onChange={(event) =>
                setMaxUses(event.target.value === 'unlimited' ? null : Number(event.target.value))
              }
              className="w-full rounded-xl border border-white/10 bg-ink-850 px-3 py-2 text-sm text-zinc-200 focus:border-accent-500/50 focus:outline-none"
            >
              {USES_OPTIONS.map((option) => (
                <option key={option.label} value={option.value === null ? 'unlimited' : option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <button
          type="button"
          onClick={() => createMutation.mutate()}
          disabled={createMutation.isPending}
          className="btn-primary mt-4"
        >
          {createMutation.isPending ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
          Generate invite
        </button>

        {lastCreated && (
          <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-accent-500/25 bg-accent-500/10 px-4 py-3 animate-scale-in">
            <Ticket size={16} className="text-accent-300" />
            <code className="font-mono text-lg font-bold tracking-[0.2em] text-white">
              {lastCreated.code}
            </code>
            <CopyButton value={lastCreated.code} label="Copy code" />
            <CopyButton
              value={inviteLink(lastCreated.code)}
              label="Copy invite link"
              icon={<Link2 size={14} />}
            />
            <span className="text-xs text-accent-200/80">
              {lastCreated.maxUses === null ? 'Unlimited uses' : `${lastCreated.maxUses} uses`} ·{' '}
              {countdown(lastCreated.expiresAt, now)}
            </span>
          </div>
        )}
      </section>

      {/* ------------------------------ invites --------------------------- */}
      <section>
        <SectionHeader
          title={`Invite codes (${activeCount} active)`}
          action={
            <button
              type="button"
              onClick={() => refreshInvites()}
              className="text-xs font-semibold uppercase tracking-widest text-zinc-500 hover:text-accent-300"
            >
              Refresh
            </button>
          }
        />

        {invitesQuery.isError ? (
          <ErrorState error={invitesQuery.error} onRetry={() => invitesQuery.refetch()} />
        ) : invitesQuery.isLoading ? (
          <div className="surface p-6 text-sm text-zinc-500">Loading invites…</div>
        ) : invites.length === 0 ? (
          <EmptyState
            icon={<Ticket size={24} />}
            title="No invite codes yet"
            description="Generate one above and share it — nobody can register without one."
          />
        ) : (
          <div className="surface overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-left text-sm">
                <thead className="border-b border-white/5 text-[10px] uppercase tracking-[0.18em] text-zinc-600">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Code</th>
                    <th className="px-4 py-3 font-semibold">Status</th>
                    <th className="px-4 py-3 font-semibold">Uses</th>
                    <th className="px-4 py-3 font-semibold">Expires</th>
                    <th className="px-4 py-3 font-semibold">Created</th>
                    <th className="px-4 py-3 text-right font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.03]">
                  {invites.map((invite) => (
                    <tr key={invite.id} className="transition-colors hover:bg-white/[0.02]">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <code className="font-mono font-semibold tracking-widest text-zinc-100">
                            {invite.code}
                          </code>
                          <CopyButton value={invite.code} label="Copy code" />
                          <CopyButton
                            value={inviteLink(invite.code)}
                            label="Copy invite link"
                            icon={<Link2 size={14} />}
                          />
                        </div>
                        {invite.label && (
                          <span className="mt-0.5 block text-xs text-zinc-600">{invite.label}</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${STATUS_STYLES[invite.status]}`}
                        >
                          {invite.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 tabular-nums text-zinc-400">
                        {invite.uses}
                        {invite.maxUses === null ? ' / ∞' : ` / ${invite.maxUses}`}
                      </td>
                      <td className="px-4 py-3 tabular-nums text-zinc-400">
                        {countdown(invite.expiresAt, now)}
                      </td>
                      <td className="px-4 py-3 text-xs text-zinc-600">
                        {formatDate(invite.createdAt)}
                        {invite.createdBy ? ` · ${invite.createdBy}` : ''}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            type="button"
                            onClick={() =>
                              toggleInvite.mutate({ id: invite.id, disabled: !invite.disabled })
                            }
                            title={invite.disabled ? 'Enable this code' : 'Disable this code'}
                            className={`icon-btn h-8 w-8 ${invite.disabled ? '' : 'text-emerald-400'}`}
                          >
                            {invite.disabled ? <ToggleLeft size={17} /> : <ToggleRight size={17} />}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              if (window.confirm(`Delete invite ${invite.code}? This cannot be undone.`)) {
                                removeInvite.mutate(invite.id);
                              }
                            }}
                            title="Delete this code"
                            className="icon-btn h-8 w-8 hover:text-red-400"
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      {/* ------------------------------- users ---------------------------- */}
      <section>
        <SectionHeader title={`Accounts (${users.length})`} />

        {usersQuery.isError ? (
          <ErrorState error={usersQuery.error} onRetry={() => usersQuery.refetch()} />
        ) : usersQuery.isLoading ? (
          <div className="surface p-6 text-sm text-zinc-500">Loading accounts…</div>
        ) : (
          <div className="surface overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead className="border-b border-white/5 text-[10px] uppercase tracking-[0.18em] text-zinc-600">
                  <tr>
                    <th className="px-4 py-3 font-semibold">User</th>
                    <th className="px-4 py-3 font-semibold">Role</th>
                    <th className="px-4 py-3 font-semibold">Joined</th>
                    <th className="px-4 py-3 font-semibold">Last seen</th>
                    <th className="px-4 py-3 font-semibold">Invite</th>
                    <th className="px-4 py-3 text-right font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.03]">
                  {users.map((account: AdminAccountUser) => {
                    const isSelf = account.id === user?.id;
                    return (
                      <tr key={account.id} className="transition-colors hover:bg-white/[0.02]">
                        <td className="px-4 py-3">
                          <span className="font-medium text-zinc-100">{account.username}</span>
                          {isSelf && <span className="ml-2 text-xs text-zinc-600">(you)</span>}
                          {account.disabled && (
                            <span className="ml-2 rounded-full border border-rose-400/30 bg-rose-400/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-rose-300">
                              disabled
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                              account.role === 'admin'
                                ? 'border-accent-500/30 bg-accent-500/15 text-accent-200'
                                : 'border-white/10 bg-white/5 text-zinc-400'
                            }`}
                          >
                            {account.role}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs text-zinc-500">{formatDate(account.createdAt)}</td>
                        <td className="px-4 py-3 text-xs text-zinc-500">
                          {account.lastLoginAt ? formatDate(account.lastLoginAt) : '—'}
                        </td>
                        <td className="px-4 py-3">
                          {account.inviteCode ? (
                            <code className="font-mono text-xs text-zinc-500">{account.inviteCode}</code>
                          ) : (
                            <span className="text-xs text-zinc-700">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              type="button"
                              disabled={isSelf}
                              onClick={() =>
                                updateUser.mutate({
                                  id: account.id,
                                  patch: { role: account.role === 'admin' ? 'user' : 'admin' },
                                })
                              }
                              className="rounded-lg px-2 py-1 text-xs font-medium text-zinc-400 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-30 disabled:hover:bg-transparent"
                              title={isSelf ? "You can't change your own role" : 'Change role'}
                            >
                              {account.role === 'admin' ? 'Demote' : 'Promote'}
                            </button>
                            <button
                              type="button"
                              disabled={isSelf}
                              onClick={() =>
                                updateUser.mutate({
                                  id: account.id,
                                  patch: { disabled: !account.disabled },
                                })
                              }
                              className="rounded-lg px-2 py-1 text-xs font-medium text-zinc-400 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-30 disabled:hover:bg-transparent"
                              title={isSelf ? "You can't disable yourself" : 'Enable or disable'}
                            >
                              {account.disabled ? 'Enable' : 'Disable'}
                            </button>
                            <button
                              type="button"
                              disabled={isSelf}
                              onClick={() => {
                                if (window.confirm(`Delete ${account.username}? This cannot be undone.`)) {
                                  removeUser.mutate(account.id);
                                }
                              }}
                              className="icon-btn h-8 w-8 hover:text-red-400"
                              title={isSelf ? "You can't delete yourself" : 'Delete account'}
                            >
                              <Trash2 size={15} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      <p className="flex items-center gap-2 text-xs text-zinc-600">
        <Users size={13} />
        Anyone with an active code can create an account. Disable a code to stop it being used without
        removing the accounts that already used it.
      </p>
    </div>
  );
}
