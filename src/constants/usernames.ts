/** Fake taken usernames for onboarding testing until a backend exists. */
export const TAKEN_USERNAMES = [
  'testuser',
  'admin',
  'gardengrid',
  'gardener',
  'demo',
  'user',
  'jane',
  'john',
  'plantmom',
  'plantparent',
] as const;

export const USERNAME_PATTERN = /^[a-zA-Z0-9_]{3,20}$/;

export function normalizeUsername(value: string) {
  return value.trim().toLowerCase();
}

const takenUsernameSet = new Set<string>(TAKEN_USERNAMES);

export function isUsernameTaken(value: string) {
  return takenUsernameSet.has(normalizeUsername(value));
}

export function getUsernameFormatError(value: string): string | null {
  const username = value.trim();

  if (!username) {
    return 'Choose a username to continue.';
  }

  if (!USERNAME_PATTERN.test(username)) {
    return 'Use 3–20 letters, numbers, or underscores.';
  }

  return null;
}

export function getUsernameError(value: string): string | null {
  return getUsernameFormatError(value) ?? (isUsernameTaken(value) ? 'That username is already taken. Try another.' : null);
}
