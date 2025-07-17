import pluralize from 'pluralize';

/**
 * Preset documentation text templates for consistent singular/plural handling
 */
export const presetDocs = {
  auth: {
    section: {
      singular: 'Available Authentication Method',
      plural: 'Available Authentication Methods',
    },
    description: {
      singular: 'an authentication method',
      plural: 'various authentication methods',
    },
    scheme: {
      singular: 'the available authentication scheme',
      plural: 'each available authentication scheme',
    },
    intro: {
      template: (
        count: number,
        methods: string,
        schemes: string,
        pronoun: string,
      ) =>
        `This API provides secure access through ${methods}. Below you'll find details about ${schemes} and how to use ${pronoun}.`,
    },
  },
  server: {
    section: {
      singular: 'API Server',
      plural: 'API Servers',
    },
    description: {
      singular: 'The following server is available for this API:',
      plural: 'The following servers are available for this API:',
    },
  },
  client: {
    section: {
      singular: 'Official API Client',
      plural: 'Official API Clients',
    },
    sdk: {
      singular: 'SDK',
      plural: 'SDKs',
    },
    language: {
      singular: 'a programming language',
      plural: 'multiple programming languages',
    },
    recommendation: {
      singular: 'this client',
      plural: 'these clients',
    },
    location: {
      singular: 'it',
      plural: 'them',
    },
    intro: {
      template: (
        apiTitle: string,
        count: number,
        sdks: string,
        languages: string,
        recommendation: string,
        location: string,
      ) =>
        `${apiTitle} provides official client ${sdks} for ${languages}. We recommend using ${recommendation} to interact with all stable endpoints. You can find ${location} here:`,
    },
  },
} as const;

/**
 * Common pronouns and determiners based on count
 */
export const pronouns = {
  pronoun: (count: number) => (count === 1 ? 'it' : 'them'),
  determiner: (count: number) => (count === 1 ? 'this' : 'these'),
  article: (count: number) => (count === 1 ? 'a' : ''),
} as const;

/**
 * Get the appropriate text based on count (singular/plural)
 */
export function getTextByCount<T extends Record<'singular' | 'plural', string>>(
  count: number,
  textOptions: T,
): string {
  return count === 1 ? textOptions.singular : textOptions.plural;
}

/**
 * Automatically pluralize a word based on count using the pluralize library
 */
export function pluralizeWord(word: string, count: number): string {
  return pluralize(word, count);
}

/**
 * Helper function to get common text variations based on count
 */
export function getCommonText(count: number) {
  return {
    pronoun: pronouns.pronoun(count),
    determiner: pronouns.determiner(count),
    article: pronouns.article(count),
    isAre: count === 1 ? 'is' : 'are',
    hasHave: count === 1 ? 'has' : 'have',
  };
}

export function getAuthIntroText(count: number): string {
  const methods = getTextByCount(count, presetDocs.auth.description);
  const schemes = getTextByCount(count, presetDocs.auth.scheme);
  const pronoun = pronouns.pronoun(count);

  return presetDocs.auth.intro.template(count, methods, schemes, pronoun);
}

export function getClientIntroText(apiTitle: string, count: number): string {
  const sdks = getTextByCount(count, presetDocs.client.sdk);
  const languages = getTextByCount(count, presetDocs.client.language);
  const recommendation = getTextByCount(
    count,
    presetDocs.client.recommendation,
  );
  const location = getTextByCount(count, presetDocs.client.location);

  return presetDocs.client.intro.template(
    apiTitle,
    count,
    sdks,
    languages,
    recommendation,
    location,
  );
}
