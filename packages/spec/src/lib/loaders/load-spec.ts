import type { OpenAPIObject } from 'openapi3-ts/oas31';

import { loadLocal } from './local-loader';
import { loadRemote } from './remote-loader';

export function loadSpec(location: string): Promise<OpenAPIObject> {
  const [protocol] = location.split(':');
  if (protocol === 'http' || protocol === 'https') {
    return loadRemote(location);
  }
  return loadLocal(location);
}
