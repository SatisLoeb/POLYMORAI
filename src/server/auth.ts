import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type express from 'express';
import type { Store } from './store';

const COOKIE = 'polymorphe_session';
const SESSION_TTL_MS = 12 * 3600_000;
const SCRYPT = { N: 1 << 15, r: 8, p: 1, keyLen: 64, maxmem: 64 * 1024 * 1024 };
const MAX_FAILURES = 5;
const LOCKOUT_MS = 15 * 60_000;

export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 256;

function sha256(s: string): string {
  return crypto.createHash('sha256').update(s).digest('hex');
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(password, salt, SCRYPT.keyLen, {
    N: SCRYPT.N,
    r: SCRYPT.r,
    p: SCRYPT.p,
    maxmem: SCRYPT.maxmem,
  });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export function verifyPassword(password: string, encoded: string): boolean {
  const parts = encoded.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, nS, rS, pS, saltB64, keyB64] = parts;
  const expected = Buffer.from(keyB64, 'base64');
  const key = crypto.scryptSync(password, Buffer.from(saltB64, 'base64'), expected.length, {
    N: Number(nS),
    r: Number(rS),
    p: Number(pS),
    maxmem: SCRYPT.maxmem,
  });
  return key.length === expected.length && crypto.timingSafeEqual(key, expected);
}

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

function isSecureRequest(req: express.Request): boolean {
  return req.secure || req.headers['x-forwarded-proto'] === 'https';
}

export class Auth {
  private failures = new Map<string, { count: number; lockedUntil: number }>();
  /** One-time token required to claim a fresh instance (printed on stdout, like Jupyter). */
  readonly setupToken: string | null;

  constructor(private store: Store) {
    const envPassword = process.env.POLYMORPHE_ADMIN_PASSWORD;
    if (!store.state.auth.passwordHash && envPassword && envPassword.length >= PASSWORD_MIN) {
      store.state.auth.passwordHash = hashPassword(envPassword);
      store.log('info', 'auth', 'Mot de passe opérateur initialisé depuis POLYMORPHE_ADMIN_PASSWORD.');
      store.commit();
    }
    if (!store.state.auth.passwordHash) {
      this.setupToken = crypto.randomBytes(18).toString('base64url');
      const tokenFile = path.join(store.dataDir, 'setup-token');
      fs.writeFileSync(tokenFile, `${this.setupToken}\n`, { mode: 0o600 });
    } else {
      this.setupToken = null;
    }
    this.pruneSessions();
  }

  get setupRequired(): boolean {
    return !this.store.state.auth.passwordHash;
  }

  private pruneSessions() {
    const now = Date.now();
    this.store.state.auth.sessions = this.store.state.auth.sessions.filter(
      (s) => Date.parse(s.expiresAt) > now
    );
  }

  checkSetupToken(token: unknown): boolean {
    if (!this.setupToken || typeof token !== 'string') return false;
    const a = Buffer.from(sha256(token));
    const b = Buffer.from(sha256(this.setupToken));
    return crypto.timingSafeEqual(a, b);
  }

  setPassword(password: string) {
    this.store.state.auth.passwordHash = hashPassword(password);
    this.store.state.auth.sessions = [];
    try {
      fs.unlinkSync(path.join(this.store.dataDir, 'setup-token'));
    } catch {
      // already gone
    }
  }

  /** Returns null when allowed, or the number of seconds the caller must wait. */
  lockoutRemaining(ip: string): number | null {
    const entry = this.failures.get(ip);
    if (!entry || entry.lockedUntil <= Date.now()) return null;
    return Math.ceil((entry.lockedUntil - Date.now()) / 1000);
  }

  recordFailure(ip: string) {
    const entry = this.failures.get(ip) ?? { count: 0, lockedUntil: 0 };
    entry.count += 1;
    if (entry.count >= MAX_FAILURES) {
      entry.lockedUntil = Date.now() + LOCKOUT_MS;
      entry.count = 0;
    }
    this.failures.set(ip, entry);
  }

  login(username: unknown, password: unknown): boolean {
    const hash = this.store.state.auth.passwordHash;
    if (!hash || typeof password !== 'string' || typeof username !== 'string') return false;
    if (password.length > PASSWORD_MAX) return false;
    const userOk = crypto.timingSafeEqual(
      Buffer.from(sha256(username.trim())),
      Buffer.from(sha256(this.store.state.auth.user))
    );
    const passOk = verifyPassword(password, hash);
    return userOk && passOk;
  }

  issueSession(req: express.Request, res: express.Response): void {
    this.pruneSessions();
    const token = crypto.randomBytes(32).toString('base64url');
    const now = Date.now();
    this.store.state.auth.sessions.push({
      tokenHash: sha256(token),
      user: this.store.state.auth.user,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + SESSION_TTL_MS).toISOString(),
    });
    this.store.commit();
    const attrs = [
      `${COOKIE}=${token}`,
      'Path=/',
      'HttpOnly',
      'SameSite=Strict',
      `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
    ];
    if (isSecureRequest(req)) attrs.push('Secure');
    res.setHeader('Set-Cookie', attrs.join('; '));
  }

  revokeSession(req: express.Request, res: express.Response) {
    const token = parseCookies(req.headers.cookie)[COOKIE];
    if (token) {
      const h = sha256(token);
      this.store.state.auth.sessions = this.store.state.auth.sessions.filter((s) => s.tokenHash !== h);
      this.store.commit();
    }
    res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`);
  }

  sessionUser(req: express.Request): string | null {
    const token = parseCookies(req.headers.cookie)[COOKIE];
    if (!token) return null;
    const h = sha256(token);
    const now = Date.now();
    const s = this.store.state.auth.sessions.find((x) => x.tokenHash === h && Date.parse(x.expiresAt) > now);
    return s ? s.user : null;
  }

  /**
   * CSRF: state-changing requests must be JSON (no simple cross-site form can send it)
   * and, when an Origin header is present, it must match the Host.
   */
  static csrfGuard(req: express.Request, res: express.Response, next: express.NextFunction) {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
    const ct = String(req.headers['content-type'] || '');
    if (!ct.toLowerCase().startsWith('application/json')) {
      return res.status(415).json({ error: 'Content-Type application/json requis.' });
    }
    const origin = req.headers.origin;
    if (origin) {
      let host: string | null = null;
      try {
        host = new URL(origin).host;
      } catch {
        host = null;
      }
      if (!host || host !== req.headers.host) {
        return res.status(403).json({ error: 'Origine refusée.' });
      }
    }
    return next();
  }

  middleware() {
    return (req: express.Request, res: express.Response, next: express.NextFunction) => {
      const user = this.sessionUser(req);
      if (!user) return res.status(401).json({ error: 'Authentification requise.', code: 'AUTH_REQUIRED' });
      (req as express.Request & { user?: string }).user = user;
      return next();
    };
  }
}

export function requestUser(req: express.Request): string {
  return (req as express.Request & { user?: string }).user ?? 'unknown';
}
