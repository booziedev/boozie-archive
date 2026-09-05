import { createContext, useCallback, useContext, useMemo } from 'react';
import type { ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { auth } from '../lib/api';
import type { AccountUser, AuthContextInfo } from '../lib/types';

/**
 * Session state.
 *
 * The session itself is an httpOnly cookie the browser manages; this context
 * only mirrors *who* that cookie belongs to, so the UI can gate routes and show
 * the right menu. Signing in or out invalidates every cached query, since the
 * data a signed-out visitor may see is not the same.
 */
interface AuthContextValue {
  user: AccountUser | null;
  info: AuthContextInfo | null;
  isLoading: boolean;
  isAdmin: boolean;
  /** True when the archive requires an account and nobody is signed in. */
  needsAuth: boolean;
  /** True when maintenance is on and this viewer is not an admin. */
  lockedOut: boolean;
  signIn: (username: string, password: string) => Promise<void>;
  signUp: (input: { username: string; password: string; inviteCode?: string }) => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();

  const contextQuery = useQuery({
    queryKey: ['auth', 'context'],
    queryFn: auth.context,
    staleTime: 30_000,
    // Polled so maintenance mode and a new announcement reach people who are
    // already sitting on a page, without them having to reload.
    refetchInterval: 60_000,
    retry: 1,
  });

  const meQuery = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: auth.me,
    staleTime: 60_000,
    retry: false,
  });

  const info = contextQuery.data ?? null;
  const user = meQuery.data?.user ?? null;

  /** Drops cached library data that belonged to the previous visitor. */
  const resetCaches = useCallback(async () => {
    await queryClient.invalidateQueries();
  }, [queryClient]);

  const signIn = useCallback(
    async (username: string, password: string) => {
      const result = await auth.login(username, password);
      queryClient.setQueryData(['auth', 'me'], { user: result.user });
      await resetCaches();
    },
    [queryClient, resetCaches],
  );

  const signUp = useCallback(
    async (input: { username: string; password: string; inviteCode?: string }) => {
      const result = await auth.register(input);
      queryClient.setQueryData(['auth', 'me'], { user: result.user });
      // A fresh install stops needing setup once the first account exists.
      await queryClient.invalidateQueries({ queryKey: ['auth', 'context'] });
      await resetCaches();
    },
    [queryClient, resetCaches],
  );

  const signOut = useCallback(async () => {
    // Deliberately not swallowed: if the server fails to end the session the
    // cookie is still live, and pretending otherwise is how the Safari
    // "logout does nothing" bug hid for so long.
    try {
      await auth.logout();
    } catch (error) {
      console.error('Sign out failed on the server', error);
    }
    queryClient.setQueryData(['auth', 'me'], { user: null });
    queryClient.clear();

    /**
     * Reload rather than re-render.
     *
     * The server now sends `no-store` on API replies, which is the actual fix
     * for Safari serving a cached /api/auth/me after signing out. A full reload
     * on top of that guarantees no stale in-memory state survives either — and
     * it drops the playback queue, which should not follow one account into the
     * next person's session on a shared device.
     */
    try {
      localStorage.removeItem('boozie.player.session.v1');
    } catch {
      // Storage disabled — nothing to clear.
    }
    window.location.replace('/');
  }, [queryClient]);

  const value = useMemo<AuthContextValue>(() => {
    const authRequired = Boolean(info?.authEnabled) && !info?.allowPublicBrowse;
    const maintenanceOn = Boolean(info?.maintenance?.enabled);
    return {
      user,
      info,
      lockedOut: maintenanceOn && user?.role !== 'admin',
      isLoading: contextQuery.isLoading || meQuery.isLoading,
      isAdmin: user?.role === 'admin',
      needsAuth: authRequired && !user,
      signIn,
      signUp,
      signOut,
      refresh: async () => {
        await meQuery.refetch();
      },
    };
  }, [contextQuery.isLoading, info, meQuery, signIn, signOut, signUp, user]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>');
  return context;
}
