import pluralize from 'pluralize';

export const docTemplates = {
  servers: {
    sectionTitle: 'API Server',
    description: 'The following {count} {isAre} available for this API:',
  },
  authMethods: {
    sectionTitle: 'Available Authentication Method',
    introText:
      "This API provides secure access through {countText} authentication {method}. Below you'll find details about {articleCount} available authentication {scheme} and how to use {pronoun}.",
    noAuthText: 'This API does not require authentication.',
  },
  apiClients: {
    sectionTitle: 'Official API Client',
    description:
      '{apiTitle} provides official client SDK{sdkPlural} for {languageText}. We recommend using {clientText} to interact with all stable endpoints. You can find {pronoun} here:',
  },
  needHelp: {
    sectionTitle: 'Need Help?',
  },
} as const;

interface CountTextOptions {
  count: number;
  word: string;
  includeCount?: boolean;
}

export function getCountText(options: CountTextOptions): string {
  const { count, word, includeCount = false } = options;
  const pluralizedWord =
    count === 1 ? pluralize.singular(word) : pluralize.plural(word);
  return includeCount ? `${count} ${pluralizedWord}` : pluralizedWord;
}

export function getPronoun(
  count: number,
  type: 'subject' | 'object' = 'object',
): string {
  if (type === 'subject') {
    return count === 1 ? 'it' : 'they';
  }
  return count === 1 ? 'it' : 'them';
}

export function getArticle(count: number, word: string): string {
  if (count === 1) {
    const firstLetter = word.charAt(0).toLowerCase();
    return ['a', 'e', 'i', 'o', 'u'].includes(firstLetter) ? 'an' : 'a';
  }
  return '';
}

export function getIsAre(count: number): string {
  return count === 1 ? 'is' : 'are';
}

export function getThisThese(count: number): string {
  return count === 1 ? 'this' : 'these';
}

export function processTemplate(
  template: string,
  replacements: Record<string, string | number>,
): string {
  return template.replace(/\{([^}]+)\}/g, (match, key) => {
    const value = replacements[key];
    return value !== undefined ? String(value) : match;
  });
}

export function getServerText(count: number): {
  title: string;
  description: string;
} {
  return {
    title: `## ${getCountText({ count, word: 'server', includeCount: false })}`,
    description: processTemplate(docTemplates.servers.description, {
      count: getCountText({ count, word: 'server', includeCount: true }),
      isAre: getIsAre(count),
    }),
  };
}

export function getAuthMethodText(count: number): {
  title: string;
  intro: string;
} {
  const countText =
    count === 1 ? getArticle(count, 'authentication method') : 'various';
  const articleCount = count === 1 ? 'the' : 'each';

  return {
    title: `## ${getCountText({ count, word: docTemplates.authMethods.sectionTitle })}`,
    intro: processTemplate(docTemplates.authMethods.introText, {
      countText,
      method: getCountText({ count, word: 'method' }),
      articleCount,
      scheme: getCountText({ count, word: 'scheme' }),
      pronoun: getPronoun(count),
    }),
  };
}

export function getApiClientText(
  count: number,
  apiTitle: string,
): {
  title: string;
  description: string;
} {
  const languageText =
    count === 1 ? 'a programming language' : 'multiple programming languages';
  const clientText =
    count === 1
      ? getThisThese(count) + ' client'
      : getThisThese(count) + ' clients';

  return {
    title: `## ${getCountText({ count, word: docTemplates.apiClients.sectionTitle })}`,
    description: processTemplate(docTemplates.apiClients.description, {
      apiTitle,
      sdkPlural: count === 1 ? '' : 's',
      languageText,
      clientText,
      pronoun: getPronoun(count),
    }),
  };
}

export function getAuthText(count: number): {
  title: string;
  intro: string;
} {
  const countText =
    count === 1 ? getArticle(count, 'authentication method') : 'various';
  const articleCount = count === 1 ? 'the' : 'each';

  return {
    title: `## ${getCountText({ count, word: docTemplates.authMethods.sectionTitle })}`,
    intro: processTemplate(docTemplates.authMethods.introText, {
      countText,
      method: getCountText({ count, word: 'method' }),
      articleCount,
      scheme: getCountText({ count, word: 'scheme' }),
      pronoun: getPronoun(count),
    }),
  };
}

export function getErrorsApiClientText(
  count: number,
  apiTitle: string,
  sdkList: string[],
): {
  title: string;
  description: string;
} {
  const languageText = count === 1 ? sdkList[0] : sdkList.join(', ');
  const clientText =
    count === 1
      ? getThisThese(count) + ' client'
      : getThisThese(count) + ' clients';

  return {
    title: `## ${getCountText({ count, word: docTemplates.apiClients.sectionTitle })}`,
    description: `${apiTitle} maintains official API ${getCountText({ count, word: 'client' })}${count > 0 ? ` for ${languageText}` : ''}. We recommend using ${clientText} to interact with all stable endpoints. You can find ${getPronoun(count)} here:`,
  };
}
