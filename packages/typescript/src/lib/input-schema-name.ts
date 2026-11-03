import { camelcase } from 'stringcase';

import { type OperationInput, inputName } from '@sdk-it/spec';

/** The name the generated `inputs` module exports `input`'s schema under: `uploadFileSchema`, or `uploadFileFormdataSchema` for a variant. */
export function inputSchemaName(operationId: string, input: OperationInput) {
  return camelcase(`${inputName(operationId, input)} schema`);
}
