// Error taxonomy for everything that talks to Amazon. Messages are user-facing
// (pt-BR) and actionable; the classes let callers (browser client, sync, tools,
// CLI) branch on the *kind* of failure without parsing text.

export const LOGIN_HINT = "Rode `amazon login` no terminal (login manual no navegador).";

/** No session, or Amazon bounced us to /ap/signin. Fix: `amazon login`. */
export class AuthError extends Error {
  constructor(message: string) {
    super(`${message} ${LOGIN_HINT}`);
    this.name = "AuthError";
  }
}

/**
 * AWS WAF challenge (`/errors/validateCaptcha`). The client is disabled for the
 * rest of the process and a cooldown is persisted, because retrying is what
 * deepens the block: solving it needs a human in a real window.
 */
export class CaptchaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CaptchaError";
  }
}

/**
 * The page arrived but Amazon's client-side decryption never replaced the
 * encrypted order cards (`.csd-encrypted-sensitive`) with real content. This is
 * NOT missing auth: the skeleton renders either way, which is exactly why it
 * needs its own class — treating it as "zero orders" would silently truncate
 * the history.
 */
export class CsdError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CsdError";
  }
}

/** Transport-level failure (navigation, unexpected status, timeout). */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

/** The encrypted session file or its key is unusable. */
export class SessionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SessionError";
  }
}

/** The interactive browser login did not complete. */
export class LoginError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LoginError";
  }
}

/**
 * The decrypted DOM no longer looks like what the parsers expect — Amazon
 * changed the page. Actionable: `amazon doctor` says which layer broke,
 * `docs/REDISCOVERY.md` says how to remap the selectors.
 */
export class ParseError extends Error {
  constructor(message: string) {
    super(`${message} Rode \`amazon doctor\` para ver qual camada quebrou.`);
    this.name = "ParseError";
  }
}
