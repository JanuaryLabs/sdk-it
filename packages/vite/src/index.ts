import type { OpenAPIObject } from 'openapi3-ts/oas31';
import type { Plugin } from 'vite';

import { DiskSdk, type DiskSdkSettings } from './disk-sdk.ts';
import { ProjectSdk, type ProjectSdkOptions } from './project.ts';
import {
  DocumentSpecSource,
  FileSpecSource,
  LazySpecSource,
} from './spec-source.ts';

export type { DiskSdkSettings } from './disk-sdk.ts';
export type { ProjectSdkOptions } from './project.ts';

/** The sdk-it Vite plugins, one factory for each way an SDK comes to the app. */
export const sdkIt = {
  /** Generates an SDK on disk from the spec at `location`: a path relative to the Vite root, or a URL. */
  file(location: string, settings: DiskSdkSettings): Plugin {
    return new DiskSdk(new FileSpecSource(location), settings).toPlugin();
  },
  /** Generates an SDK on disk from a spec object. */
  document(document: OpenAPIObject, settings: DiskSdkSettings): Plugin {
    return new DiskSdk(new DocumentSpecSource(document), settings).toPlugin();
  },
  /** Generates an SDK on disk from the location or object `resolve` gives once Vite resolves its config. */
  lazy(
    resolve: () => string | OpenAPIObject | Promise<string | OpenAPIObject>,
    settings: DiskSdkSettings,
  ): Plugin {
    return new DiskSdk(new LazySpecSource(resolve), settings).toPlugin();
  },
  /** Generates every client of an sdk-it project config. */
  project(options: ProjectSdkOptions): Plugin {
    return new ProjectSdk(options).toPlugin();
  },
};

export default sdkIt;
