import { getTextByCount, presetDocs } from './doc-text-utils.js';
import type { SdkDoc, SdkLanguage } from './types.js';

interface SdkLanguageDocs {
  title: string;
  install(packageName: string): string;
  registry(packageName: string): string;
}

const sdkLanguages: Record<SdkLanguage, SdkLanguageDocs> = {
  typescript: {
    title: 'TypeScript',
    install: (packageName) => `npm install ${packageName}`,
    registry: (packageName) => `https://www.npmjs.com/package/${packageName}`,
  },
  python: {
    title: 'Python',
    install: (packageName) => `pip install ${packageName}`,
    registry: (packageName) => `https://pypi.org/project/${packageName}`,
  },
  dart: {
    title: 'Dart',
    install: (packageName) => `dart pub add ${packageName}`,
    registry: (packageName) => `https://pub.dev/packages/${packageName}`,
  },
};

const listFormat = new Intl.ListFormat('en', { type: 'conjunction' });

export function generateSdkSection(apiTitle: string, sdks: SdkDoc[]): string[] {
  if (sdks.length === 0) return [];

  const languages = listFormat.format(
    sdks.map((sdk) => sdkLanguages[sdk.language].title),
  );
  const markdown: string[] = [
    `## ${getTextByCount(sdks.length, presetDocs.client.section)}`,
    `${apiTitle} provides ${sdks.length === 1 ? 'an official client SDK' : 'official client SDKs'} for ${languages}. Install ${sdks.length === 1 ? 'it' : 'one'} to get started:`,
  ];

  for (const sdk of sdks) {
    const language = sdkLanguages[sdk.language];
    markdown.push(`### ${language.title}`);
    markdown.push(['```bash', language.install(sdk.package), '```'].join('\n'));
    markdown.push(
      `[${sdk.package}](${sdk.url ?? language.registry(sdk.package)})`,
    );
  }

  return markdown;
}
