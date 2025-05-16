import type z from 'zod';

import type { Unionize } from '../http/dispatcher.ts';
import type { ParseError } from '../http/parser.ts';
import type {
  ProblematicResponse,
  SuccessfulResponse,
} from '../http/response.ts';
import schemas from './schemas.ts';

type EndpointOutput<K extends keyof typeof schemas> = Extract<
  Unionize<(typeof schemas)[K]['output']>,
  SuccessfulResponse
>;

type EndpointError<K extends keyof typeof schemas> = Extract<
  Unionize<(typeof schemas)[K]['output']>,
  ProblematicResponse
>;

export type Endpoints = {
  [K in keyof typeof schemas]: {
    input: z.infer<(typeof schemas)[K]['schema']>;
    output: EndpointOutput<K>['data'];
    error: EndpointError<K> | ParseError<(typeof schemas)[K]['schema']>;
  };
};
