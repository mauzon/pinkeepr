export const CYRILLIC_RE = /[А-Яа-яЁё]/;

export function hasCyrillic(value: string | null | undefined): boolean {
  if (!value) return false;
  return CYRILLIC_RE.test(value);
}

export function assertEnglishSurface(value: string | null | undefined, field: string): void {
  if (value && hasCyrillic(value)) {
    throw new ValidationLocaleError(field);
  }
}

export class ValidationLocaleError extends Error {
  constructor(public readonly field: string) {
    super(`Cyrillic on English field: ${field}`);
    this.name = "ValidationLocaleError";
  }
}