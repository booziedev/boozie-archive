import type { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';

import { config } from '../config.js';
import {
  AuthError,
  changePassword,
  countUsers,
  createSession,
  destroySession,
  login,
  peekInvite,
  register,
  type PublicUser,
} from '../lib/auth.js';

/**
 * Sign-up, sign-in and session endpoints.
 *
 * Sessions are opaque tokens in an httpOnly cookie rather than a JWT in
 * localStorage, because `<audio src>` and `<img src>` cannot attach an
 * Authorization header — cookies are the only credential the media elements
 * can carry.
 */

declare module 'fastify' {
  interface FastifyRequest {
    /** Populated by the authentication hook; null when signed out. */
    user: PublicUser | null;
  }
}

/** Simple in-memory throttle. One process, one Pi — no shared store needed. */
class LoginThrottle {
  private attempts = new Map<string, { count: number; resetAt: number }>();

  check(key: string): void {
    const entry = this.attempts.get(key);
    if (!entry) return;
    if (Date.now() > entry.resetAt) {
      this.attempts.delete(key);
      return;
    }
    if (entry.count >= config.loginMaxAttempts) {
      const minutes = Math.ceil((entry.resetAt - Date.now()) / 60_000);
      throw new AuthError(
        `Too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`,
        429,
        'rate_limited',
      );
    }
  }

  fail(key: string): void {
    const now = Date.now();
    const entry = this.attempts.get(key);
    if (!entry || now > entry.resetAt) {
      this.attempts.set(key, { count: 1, resetAt: now + config.loginWindowMinutes * 60_000 });
      return;
    }
    entry.count += 1;
  }

  succeed(key: string): void {
    this.attempts.delete(key);
  }

  /** Called periodically so the map can't grow without bound. */
  prune(): void {
    const now = Date.now();
    for (const [key, entry] of this.attempts) if (now > entry.resetAt) this.attempts.delete(key);
  }
}

export const loginThrottle = new LoginThrottle();

export function setSessionCookie(reply: FastifyReply, token: string, expiresAt: Date) {
  reply.setCookie(config.cookieName, token, {
    path: '/',
    httpOnly: true,
    sameSite: config.cookieSameSite,
    secure: config.cookieSecure,
    expires: expiresAt,
  });
}

export function clearSessionCookie(reply: FastifyReply) {
  reply.clearCookie(config.cookieName, {
    path: '/',
    httpOnly: true,
    sameSite: config.cookieSameSite,
    secure: config.cookieSecure,
  });
}

function clientIp(request: FastifyRequest): string {
  return request.ip;
}

export const authRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  /**
   * What the sign-in screen needs before showing anything: whether accounts are
   * required at all, and whether this is a fresh install whose first account
   * becomes the admin.
   */
  app.get('/auth/context', async () => {
    if (!config.authEnabled) {
      return { authEnabled: false, needsSetup: false, allowPublicBrowse: true };
    }
    const users = await countUsers();
    return {
      authEnabled: true,
      needsSetup: users === 0,
      allowPublicBrowse: config.allowPublicBrowse,
      minPasswordLength: config.minPasswordLength,
    };
  });

  app.get('/auth/me', async (request) => ({ user: request.user }));

  app.post('/auth/register', async (request, reply) => {
    if (!config.authEnabled) {
      return reply.code(404).send({ error: 'Accounts are disabled on this server.' });
    }

    const body = (request.body ?? {}) as {
      username?: string;
      password?: string;
      inviteCode?: string;
    };

    const user = await register({
      username: String(body.username ?? ''),
      password: String(body.password ?? ''),
      inviteCode: body.inviteCode ? String(body.inviteCode) : undefined,
      ip: clientIp(request),
    });

    const { token, expiresAt } = await createSession(user.id, {
      userAgent: request.headers['user-agent'],
      ip: clientIp(request),
    });
    setSessionCookie(reply, token, expiresAt);

    return reply.code(201).send({ user });
  });

  app.post('/auth/login', async (request, reply) => {
    if (!config.authEnabled) {
      return reply.code(404).send({ error: 'Accounts are disabled on this server.' });
    }

    const body = (request.body ?? {}) as { username?: string; password?: string };
    const username = String(body.username ?? '').trim();
    const password = String(body.password ?? '');
    const key = `${clientIp(request)}:${username.toLowerCase()}`;

    loginThrottle.check(key);

    const user = await login(username, password);
    if (!user) {
      loginThrottle.fail(key);
      return reply.code(401).send({ error: 'Incorrect username or password.' });
    }
    loginThrottle.succeed(key);

    const { token, expiresAt } = await createSession(user.id, {
      userAgent: request.headers['user-agent'],
      ip: clientIp(request),
    });
    setSessionCookie(reply, token, expiresAt);

    return { user };
  });

  app.post('/auth/logout', async (request, reply) => {
    const token = request.cookies[config.cookieName];
    if (token) await destroySession(token);
    clearSessionCookie(reply);
    return { ok: true };
  });

  /** Lets the register form show "code valid" before the user fills anything in. */
  app.get('/auth/invite/:code', async (request) => {
    const { code } = request.params as { code: string };
    if (!config.authEnabled) return { valid: false, reason: 'Accounts are disabled on this server.' };
    return peekInvite(code);
  });

  app.post('/auth/password', async (request, reply) => {
    if (!request.user) return reply.code(401).send({ error: 'Sign in first.' });

    const body = (request.body ?? {}) as { currentPassword?: string; newPassword?: string };
    await changePassword(
      request.user.id,
      String(body.currentPassword ?? ''),
      String(body.newPassword ?? ''),
    );

    // changePassword revokes every session, so issue a fresh one for this device.
    const { token, expiresAt } = await createSession(request.user.id, {
      userAgent: request.headers['user-agent'],
      ip: clientIp(request),
    });
    setSessionCookie(reply, token, expiresAt);

    return { ok: true };
  });
};
