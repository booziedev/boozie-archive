import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { AlertCircle, Check, Disc3, Loader2, Lock, ShieldCheck, Ticket, User, X } from 'lucide-react';

import { auth } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { useDebounced } from '../hooks/useDebounced';
import { siteName, siteTagline } from '../lib/config';

type Mode = 'signin' | 'signup';

/**
 * The gate in front of the archive: sign in, or create an account with an
 * invite code. Landing on /invite/<code> prefills the code and opens the
 * sign-up tab, so a shared link is one field away from an account.
 */
export function AuthPage() {
  const { info, signIn, signUp } = useAuth();
  const params = useParams<{ code?: string }>();
  const invitedCode = params.code ?? '';

  const needsSetup = info?.needsSetup ?? false;
  const minLength = info?.minPasswordLength ?? 8;

  const [mode, setMode] = useState<Mode>(needsSetup || invitedCode ? 'signup' : 'signin');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [inviteCode, setInviteCode] = useState(invitedCode);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // A fresh install always starts on the sign-up tab.
  useEffect(() => {
    if (needsSetup) setMode('signup');
  }, [needsSetup]);

  // Live invite validation, so a bad code is caught before filling the form in.
  const debouncedCode = useDebounced(inviteCode.trim(), 350);
  const [inviteState, setInviteState] = useState<
    { status: 'idle' | 'checking' | 'valid' } | { status: 'invalid'; reason: string }
  >({ status: 'idle' });

  useEffect(() => {
    if (needsSetup || mode !== 'signup' || debouncedCode.length < 4) {
      setInviteState({ status: 'idle' });
      return;
    }
    let cancelled = false;
    setInviteState({ status: 'checking' });
    auth
      .checkInvite(debouncedCode)
      .then((result) => {
        if (cancelled) return;
        setInviteState(
          result.valid
            ? { status: 'valid' }
            : { status: 'invalid', reason: result.reason ?? 'That code is not usable.' },
        );
      })
      .catch(() => {
        if (!cancelled) setInviteState({ status: 'idle' });
      });
    return () => {
      cancelled = true;
    };
  }, [debouncedCode, mode, needsSetup]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    if (mode === 'signup') {
      if (password !== confirm) {
        setError('The two passwords do not match.');
        return;
      }
      if (password.length < minLength) {
        setError(`Passwords must be at least ${minLength} characters.`);
        return;
      }
    }

    setBusy(true);
    try {
      if (mode === 'signin') {
        await signIn(username, password);
      } else {
        await signUp({
          username,
          password,
          inviteCode: needsSetup ? undefined : inviteCode.trim(),
        });
      }
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Something went wrong.');
      setBusy(false);
    }
  }

  const fieldClass =
    'w-full rounded-xl border border-white/10 bg-white/[0.04] px-3.5 py-2.5 pl-10 text-sm text-zinc-100 ' +
    'placeholder:text-zinc-600 transition-colors focus:border-accent-500/60 focus:bg-white/[0.07] focus:outline-none ' +
    'focus:ring-2 focus:ring-accent-500/20';

  return (
    <div className="relative flex min-h-[100dvh] items-center justify-center px-4 py-10">
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-0 h-[32rem] w-[32rem] -translate-x-1/2 rounded-full bg-accent-500/15 blur-3xl"
      />

      <div className="relative w-full max-w-md animate-fade-up">
        <div className="mb-7 text-center">
          <span className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-accent-500 to-glow shadow-glow">
            <Disc3 size={26} className="text-white" />
          </span>
          <h1 className="text-xl font-extrabold tracking-[0.16em] text-white">{siteName}</h1>
          <p className="mt-1.5 text-sm text-zinc-500">{siteTagline}</p>
        </div>

        <div className="surface p-6">
          {needsSetup ? (
            <div className="mb-5 flex gap-3 rounded-xl border border-accent-500/25 bg-accent-500/10 p-3.5">
              <ShieldCheck size={18} className="mt-0.5 shrink-0 text-accent-300" />
              <div className="space-y-1">
                <p className="text-sm font-semibold text-accent-100">Set up the archive</p>
                <p className="text-xs leading-relaxed text-accent-200/80">
                  No accounts exist yet, so this first one becomes the admin — no invite needed. You'll
                  create invite codes for everyone else from the admin panel.
                </p>
              </div>
            </div>
          ) : (
            <div className="mb-5 flex gap-1.5 rounded-xl border border-white/5 bg-white/[0.02] p-1">
              {(
                [
                  ['signin', 'Sign in'],
                  ['signup', 'Create account'],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => {
                    setMode(value);
                    setError(null);
                  }}
                  className={`flex-1 rounded-lg px-3 py-2 text-xs font-semibold uppercase tracking-widest transition-colors ${
                    mode === value ? 'bg-white/10 text-white' : 'text-zinc-500 hover:text-zinc-300'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}

          {invitedCode && mode === 'signup' && !needsSetup && (
            <p className="mb-4 flex items-center gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">
              <Ticket size={14} />
              You've been invited — the code is filled in below.
            </p>
          )}

          <form onSubmit={handleSubmit} className="space-y-3.5">
            <div className="relative">
              <User size={16} className="pointer-events-none absolute left-3.5 top-3 text-zinc-600" />
              <input
                type="text"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                placeholder="Username"
                aria-label="Username"
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                required
                className={fieldClass}
              />
            </div>

            <div className="relative">
              <Lock size={16} className="pointer-events-none absolute left-3.5 top-3 text-zinc-600" />
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Password"
                aria-label="Password"
                autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                required
                className={fieldClass}
              />
            </div>

            {mode === 'signup' && (
              <>
                <div className="relative">
                  <Lock size={16} className="pointer-events-none absolute left-3.5 top-3 text-zinc-600" />
                  <input
                    type="password"
                    value={confirm}
                    onChange={(event) => setConfirm(event.target.value)}
                    placeholder="Confirm password"
                    aria-label="Confirm password"
                    autoComplete="new-password"
                    required
                    className={fieldClass}
                  />
                </div>

                {!needsSetup && (
                  <div>
                    <div className="relative">
                      <Ticket size={16} className="pointer-events-none absolute left-3.5 top-3 text-zinc-600" />
                      <input
                        type="text"
                        value={inviteCode}
                        onChange={(event) => setInviteCode(event.target.value)}
                        placeholder="Invite code"
                        aria-label="Invite code"
                        autoCapitalize="none"
                        autoCorrect="off"
                        spellCheck={false}
                        required
                        className={`${fieldClass} pr-10 font-mono tracking-wider`}
                      />
                      <span className="absolute right-3.5 top-3">
                        {inviteState.status === 'checking' && (
                          <Loader2 size={15} className="animate-spin text-zinc-600" />
                        )}
                        {inviteState.status === 'valid' && <Check size={15} className="text-emerald-400" />}
                        {inviteState.status === 'invalid' && <X size={15} className="text-red-400" />}
                      </span>
                    </div>
                    {inviteState.status === 'invalid' && (
                      <p className="mt-1.5 text-xs text-red-400">{inviteState.reason}</p>
                    )}
                    {inviteState.status === 'valid' && (
                      <p className="mt-1.5 text-xs text-emerald-400">This code is valid.</p>
                    )}
                  </div>
                )}
              </>
            )}

            {error && (
              <p className="flex items-start gap-2 rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2.5 text-xs leading-relaxed text-red-300">
                <AlertCircle size={14} className="mt-0.5 shrink-0" />
                {error}
              </p>
            )}

            <button type="submit" disabled={busy} className="btn-primary w-full">
              {busy && <Loader2 size={15} className="animate-spin" />}
              {mode === 'signin' ? 'Sign in' : needsSetup ? 'Create admin account' : 'Create account'}
            </button>
          </form>

          {!needsSetup && (
            <p className="mt-5 text-center text-xs leading-relaxed text-zinc-600">
              {mode === 'signin' ? (
                <>
                  Accounts are invite-only.{' '}
                  <button
                    type="button"
                    onClick={() => setMode('signup')}
                    className="text-accent-400 hover:underline"
                  >
                    Have a code?
                  </button>
                </>
              ) : (
                <>
                  Already have an account?{' '}
                  <button
                    type="button"
                    onClick={() => setMode('signin')}
                    className="text-accent-400 hover:underline"
                  >
                    Sign in
                  </button>
                </>
              )}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
