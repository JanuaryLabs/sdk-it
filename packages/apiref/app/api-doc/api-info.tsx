import { useRootData } from '../use-root-data';
import { MD } from './md';

export function ApiInfoSection() {
  const {
    spec: { info },
  } = useRootData();

  return (
    <div className="border-b p-8">
      <div className="mx-auto max-w-6xl">
        {/* <Badge className="px-1.5 py-0" variant="secondary">
          v{info.version}
        </Badge> */}
        <h1 className="mb-2 text-3xl font-bold">{info.title}</h1>

        <MD
          className="prose dark:prose-invert"
          id={'api-info-description'}
          content={info.description}
        />

        {(info.termsOfService || info.contact || info.license) && (
          <div className="mt-4 flex gap-4 text-sm text-gray-600">
            {info.termsOfService && (
              <a
                href={info.termsOfService}
                target="_blank"
                rel="noreferrer"
                className="hover:underline"
              >
                Terms of Service
              </a>
            )}
            {info.contact?.url && (
              <a
                href={info.contact.url}
                target="_blank"
                rel="noreferrer"
                className="hover:underline"
              >
                Contact
              </a>
            )}
            {info.license?.url && (
              <a
                href={info.license.url}
                target="_blank"
                rel="noreferrer"
                className="hover:underline"
              >
                License: {info.license.name}
              </a>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
