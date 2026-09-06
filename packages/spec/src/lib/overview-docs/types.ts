export type AuthoredDoc = {
  id?: string;
  title: string;
  description?: string;
  content?: string;
};

/** An authored doc whose id has been normalized to a url-safe slug. */
export type ResolvedDoc = AuthoredDoc & { id: string };

export type SdkLanguage = 'typescript' | 'python' | 'dart';

export type SdkDoc = {
  language: SdkLanguage;
  package: string;
  url?: string;
};

export const SDK_LANGUAGES: readonly SdkLanguage[] = [
  'typescript',
  'python',
  'dart',
];

/** Doc ids the apiref reserves for its own routes. */
export const RESERVED_DOC_IDS: ReadonlySet<string> = new Set(['embed']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === 'string';
}

export function isAuthoredDoc(value: unknown): value is AuthoredDoc {
  return (
    isRecord(value) &&
    typeof value.title === 'string' &&
    value.title.trim() !== '' &&
    isOptionalString(value.id) &&
    isOptionalString(value.description) &&
    isOptionalString(value.content)
  );
}

export function isSdkDoc(value: unknown): value is SdkDoc {
  return (
    isRecord(value) &&
    typeof value.language === 'string' &&
    (SDK_LANGUAGES as readonly string[]).includes(value.language) &&
    typeof value.package === 'string' &&
    value.package.trim() !== '' &&
    isOptionalString(value.url)
  );
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
