const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const MIN_PASSWORD_LENGTH = 8;

export function getEmailError(email: string): string | null {
  const trimmed = email.trim();

  if (!trimmed) {
    return 'Enter your email address.';
  }

  if (!EMAIL_PATTERN.test(trimmed)) {
    return 'Enter a valid email address.';
  }

  return null;
}

export function getPasswordError(password: string): string | null {
  if (!password) {
    return 'Enter a password.';
  }

  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  }

  return null;
}
