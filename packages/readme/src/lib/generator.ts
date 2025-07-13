import type {
  OperationEntry,
  TunedOperationObject,
} from '@sdk-it/spec/types.js';

export interface Generator {
  client(): string;
  snippet(entry: OperationEntry, operation: TunedOperationObject): string;
  clientSetupDocs(): string;
  clientInstallDocs(): string;
  configurationOptions(): {
    sections: string[];
    hasServers: boolean;
    baseUrl: string;
    hasApiKey: boolean;
  };
  configurationUpdateDocs(): string;
  paginationDocs(): string;
  errorHandlingDocs(): string;
  authenticationDocs(): string;
  generalUsageDocs(): string;
}
