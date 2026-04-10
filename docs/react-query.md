## Integrate with React Query

Wrap your type-safe API client with React Query's `useQuery` and `useMutation` hooks to get caching, synchronization, and declarative data fetching.

---

Copy the following code into your project.

- **`use-client.ts` file**:

<details>
<summary>View the API code</summary>

```ts
import { Client, type Endpoints } from '@datahub/client';
import {
  type MutationFunctionContext,
  QueryClient,
  type UseMutationOptions,
  type UseMutationResult,
  type UseQueryOptions,
  type UseQueryResult,
  useMutation,
  useMutationState,
  useQuery,
} from '@tanstack/react-query';

const BASE_URL = 'https://api.example.com';

export const queryClient = new QueryClient();

export const client = new Client({
  baseUrl: BASE_URL,
});

type DataEndpoints = {
  [K in keyof Endpoints]: K extends `${'GET'} ${string}` ? K : never;
}[keyof Endpoints];

type MutationEndpoints = {
  [K in keyof Endpoints]: K extends `${'POST' | 'PUT' | 'PATCH' | 'DELETE'} ${string}`
    ? K
    : never;
}[keyof Endpoints];

/**
 * A hook to fetch data from the API
 * @param endpoint - The API endpoint to fetch from (e.g. 'GET /payments')
 * @param params - Query parameters for the request
 * @param options - Additional options for the query
 * @returns The query result containing data and status
 *
 * @example
 * // Fetch all payments
 * const { data: payments } = useData('GET /payments', {
 *   since: '2023-01-01',
 *   until: '2023-12-31'
 * });
 */
export function useData<E extends DataEndpoints>(
  endpoint: E,
  input?: Endpoints[E]['input'],
  options?: Omit<
    UseQueryOptions<
      Endpoints[E]['output'],
      Endpoints[E]['error'],
      Endpoints[E]['output']
    >,
    'queryFn' | 'meta' | 'queryKey'
  >,
): UseQueryResult<Endpoints[E]['output'], Endpoints[E]['error']> {
  return useQuery({
    queryKey: [endpoint, JSON.stringify(input)],
    ...options,
    meta: { endpoint, input },
    queryFn: ({ signal }) =>
      client.request(endpoint, input ?? ({} as never), { signal }),
  });
}

/**
 * A hook to poll a GET endpoint until a stop condition is met.
 *
 * @param endpoint - The API endpoint to poll (e.g. 'GET /jobs/:id').
 * @param input - Input for the endpoint request.
 * @param options - Polling options including interval, enabled state, and stop condition.
 * @returns The query result containing the latest polled data and status.
 *
 * @example
 * const job = usePolling('GET /jobs/:id', { id: '123' }, {
 *   interval: 2000,
 *   shouldStop: (data) => data?.status === 'completed',
 * });
 */
export function usePolling<E extends DataEndpoints>(
  endpoint: E,
  input: Endpoints[E]['input'],
  options: {
    interval: number;
    enabled?: boolean;
    shouldStop: (data: Endpoints[E]['output'] | undefined) => boolean;
  },
): UseQueryResult<Endpoints[E]['output'], Endpoints[E]['error']> {
  const enabled = options.enabled ?? true;

  return useData(endpoint, input, {
    enabled,
    retry: false,
    refetchInterval: (query) => {
      if (options.shouldStop(query.state.data)) return false;
      return options.interval;
    },
  });
}

type WithMutationFn<E extends keyof Endpoints> = Omit<
  UseMutationOptions<Endpoints[E]['output'], Endpoints[E]['error'], unknown>,
  'mutationFn' | 'mutationKey'
> & {
  invalidate?: DataEndpoints[];
  mutationFn: (
    dispatch: (input: Endpoints[E]['input']) => Promise<Endpoints[E]['output']>,
    context: MutationFunctionContext,
  ) => Promise<Endpoints[E]['output'] | undefined>;
};
type WithoutMutationFn<E extends keyof Endpoints> = Omit<
  UseMutationOptions<
    Endpoints[E]['output'],
    Endpoints[E]['error'],
    Endpoints[E]['input']
  >,
  'mutationFn' | 'mutationKey'
> & {
  invalidate?: DataEndpoints[];
};

export type UseAction<E extends MutationEndpoints> = UseMutationResult<
  Endpoints[E]['output'],
  Endpoints[E]['error'],
  Endpoints[E]['input']
>;

/**
 * A hook to perform an action on the API with a custom mutation function.
 * The `mutate` function from the result will not take any arguments.
 * The `mutationFn` receives a `dispatch` function that you can call to trigger the API request.
 *
 * @param endpoint - The API endpoint to perform the action on (e.g. 'POST /payments').
 * @param options - Options for the mutation, including a custom `mutationFn`.
 * @returns The mutation result.
 *
 * @example
 * // Create a new payment with a custom function
 * const { mutate, isPending } = useAction('POST /payments', {
 *   mutationFn: (dispatch) => dispatch({ amount: 1000, date: '2023-01-01' }),
 *   onSuccess: () => console.log('Payment created!'),
 * });
 *
 * @example
 * // Perform logic before and after the mutation
 * const { mutate, isPending } = useAction('POST /payments', {
 *  mutationFn: async (dispatch) => {
 *   // Perform some logic before the mutation
 *   await dispatch({ amount: 1000, date: '2023-01-01' });
 *   // Perform some logic after the mutation
 *   console.log('Payment created!');
 *  },
 * });
 *
 * // later in the code
 * mutate();
 */
export function useAction<E extends MutationEndpoints>(
  endpoint: E,
  options: WithMutationFn<E>,
): UseMutationResult<Endpoints[E]['output'], Endpoints[E]['error'], void>;

/**
 * @overload
 * A hook to perform an action on the API.
 * The `mutate` function from the result expects the input for the endpoint.
 *
 * @param endpoint - The API endpoint to perform the action on (e.g. 'POST /payments').
 * @param options - Options for the mutation.
 * @returns The mutation result.
 *
 * @example
 * // Create a new payment
 * const { mutate, isPending } = useAction('POST /payments', {
 *   onSuccess: () => console.log('Payment created!'),
 * });
 *
 * // later in the code
 * mutate({ amount: 1000, date: '2023-01-01' });
 */
export function useAction<E extends MutationEndpoints>(
  endpoint: E,
  options?: WithoutMutationFn<E>,
): UseMutationResult<
  Endpoints[E]['output'],
  Endpoints[E]['error'],
  Endpoints[E]['input']
>;
export function useAction<E extends MutationEndpoints>(
  endpoint: E,
  options?: WithMutationFn<E> | WithoutMutationFn<E>,
): UseMutationResult<
  Endpoints[E]['output'],
  Endpoints[E]['error'],
  Endpoints[E]['input']
> {
  return useMutation<
    Endpoints[E]['output'],
    Endpoints[E]['error'],
    Endpoints[E]['input'],
    unknown
  >({
    ...options,
    mutationKey: [endpoint],
    mutationFn: async (input, context) => {
      if (options && 'mutationFn' in options && options.mutationFn) {
        return options.mutationFn(
          (input) => client.request(endpoint, input),
          context,
        ) as Promise<Endpoints[E]['output']>;
      }
      return (await client.request(endpoint, input)) as Endpoints[E]['output'];
    },
    onSuccess: async (data, variables, onMutateResult, context) => {
      for (const endpoint of options?.invalidate ?? []) {
        await invalidateData(endpoint);
      }
      return options?.onSuccess?.(data, variables, data, context);
    },
  });
}

export function useActionState<E extends MutationEndpoints>(endpoint: E) {
  return useMutationState({
    filters: {
      predicate(mutation) {
        return mutation.meta?.endpoint === endpoint;
      },
    },
  });
}

/**
 * Fetches data for a GET endpoint.
 *
 * @param endpoint - The API endpoint to fetch from (e.g. 'GET /payments').
 * @param input - Input for the endpoint request.
 * @param options - Additional query options for the fetch.
 * @returns A promise resolving to the endpoint response data.
 *
 * @example
 * const payments = await fetchData('GET /payments', {
 *   since: '2023-01-01',
 *   until: '2023-12-31',
 * });
 */
export function fetchData<E extends DataEndpoints>(
  endpoint: E,
  input?: Endpoints[E]['input'],
  options?: Omit<
    UseQueryOptions<
      Endpoints[E]['output'],
      Endpoints[E]['error'],
      Endpoints[E]['output']
    >,
    'queryFn' | 'meta' | 'queryKey'
  >,
): Promise<Endpoints[E]['output']> {
  return queryClient.fetchQuery({
    queryKey: [endpoint, JSON.stringify(input)],
    ...options,
    meta: { endpoint, input },
    queryFn: ({ signal }) =>
      client.request(endpoint, input ?? ({} as never), { signal }),
  });
}

/**
 * Invalidates all cached queries for a GET endpoint.
 *
 * @param endpoint - The API endpoint whose cached queries should be invalidated.
 * @returns A promise that resolves when matching queries have been invalidated.
 *
 * @example
 * await invalidateData('GET /payments');
 */
export function invalidateData(endpoint: DataEndpoints): Promise<void> {
  return queryClient.invalidateQueries({
    predicate(query) {
      return query.meta?.endpoint === endpoint;
    },
  });
}
```

</details>

## Examples

- Fetch data from the API using the `useData` hook.

```tsx
import { useData } from './use-client.ts';

function Payments() {
  const { data: payments, isLoading } = useData('GET /payments', {
    since: '2023-01-01',
    until: '2023-12-31',
  });

  if (isLoading) {
    return <div>Loading...</div>;
  }

  return (
    <ul>
      {payments.map((payment) => (
        <li key={payment.id}>{payment.amount}</li>
      ))}
    </ul>
  );
}
```

- Performing Mutations with Invalidation

```tsx
import { useState } from 'react';

import { useAction } from './use-client.ts';

function CreatePaymentForm() {
  const [amount, setAmount] = useState(0);
  const [date, setDate] = useState('');

  // The second argument specifies which queries to invalidate after successful mutation
  const { mutate, isPending, error } = useAction('POST /payments', {
    invalidate: ['GET /payments'], // This will invalidate the payments query
    mutationFn: async (dispatch) => {
      // Perform some logic before the mutation
      console.log('Creating payment...');
      const result = await dispatch({ amount, date });
      // Perform some logic after the mutation
      console.log('Payment created!', result);
      return result;
    },
    onSuccess: (result) => {
      // Handle success
    },
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        mutate(); // No arguments needed when using custom mutationFn
      }}
    >
      {/* Form fields */}
      <button type="submit" disabled={isPending}>
        {isPending ? 'Creating...' : 'Create Payment'}
      </button>
      {error && <p>Error: {error.message}</p>}
    </form>
  );
}
```

- Simple Mutation without Custom Function

```tsx
import { useAction } from './use-client.ts';

function CreatePaymentForm() {
  // Without a custom mutationFn, the mutate function accepts the input directly
  const { mutate, isPending, error } = useAction('POST /payments', {
    invalidate: ['GET /payments'],
    onSuccess: (result) => {
      console.log('Payment created!', result);
    },
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const formData = new FormData(e.currentTarget);
        // Pass the input directly to mutate
        mutate({
          amount: Number(formData.get('amount')),
          date: formData.get('date') as string,
        });
      }}
    >
      <input type="number" name="amount" placeholder="Amount" required />
      <input type="date" name="date" required />
      <button type="submit" disabled={isPending}>
        {isPending ? 'Creating...' : 'Create Payment'}
      </button>
      {error && <p>Error: {error.message}</p>}
    </form>
  );
}
```

- Polling an endpoint until a condition is met

```tsx
import { usePolling } from './use-client.ts';

function JobStatus({ jobId }: { jobId: string }) {
  const { data: job, isLoading } = usePolling(
    'GET /jobs/{id}',
    { id: jobId },
    {
      interval: 2000,
      shouldStop: (data) =>
        data?.status === 'completed' || data?.status === 'failed',
    },
  );

  if (isLoading) return <div>Loading...</div>;

  return <div>Job status: {job?.status}</div>;
}
```

- Fetching data outside of React components

```ts
import { fetchData } from './use-client.ts';

// Useful for prefetching, loaders, or non-React contexts
async function prefetchPayments() {
  const payments = await fetchData('GET /payments', {
    since: '2023-01-01',
    until: '2023-12-31',
  });
  console.log('Prefetched', payments.length, 'payments');
}
```

- Manually invalidating cached queries

```ts
import { invalidateData } from './use-client.ts';

// Force refetch of all cached payment queries
await invalidateData('GET /payments');
```

## Including Cookies

If your API relies on cookie-based authentication (e.g. session cookies), update the `client` instance in the code above to send credentials with every request:

```ts
export const client = new Client({
  baseUrl: BASE_URL,
  fetch: (request) => fetch(request, { credentials: 'include' }),
});
```

This sets [`credentials: 'include'`](https://developer.mozilla.org/en-US/docs/Web/API/RequestInit/credentials) on every outgoing request, so cookies travel cross-origin. For same-origin APIs, use `credentials: 'same-origin'` instead.
