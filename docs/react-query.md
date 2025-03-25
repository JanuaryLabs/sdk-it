## Integrate with React Query

Using the `useQuery` and `useMutation` hooks from React Query, you can integrate your API client with the library's caching and synchronization capabilities. This integration builds on React Query's declarative approach to data fetching while leveraging your type-safe API client.

---

Copy the following code into your project.

- **`api.tsx` file**:

<details>
<summary>View the API code</summary>

```ts
import { Client, type Endpoints } from '@impact/client';
import {
  type MutationFunction,
  type UseMutationOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';

export const client = new Client({
  baseUrl:
    import.meta.env.VITE_API_URL === '/'
      ? window.location.origin
      : import.meta.env.VITE_API_URL,
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
  options?: { staleTime?: number; queryKey?: string[] },
) {
  return useQuery({
    queryKey: options?.queryKey ?? [endpoint, JSON.stringify(input)],
    staleTime: options?.staleTime,
    meta: { endpoint, input },
    queryFn: async () => {
      const [result, error] = await client.request(
        endpoint,
        input ?? ({} as never),
      );
      if (error) {
        throw error;
      }
      return result;
    },
  });
}

/**
 * A hook to perform an action on the API
 * @param endpoint - The API endpoint to perform the action on (e.g. 'POST /payments')
 * @param input - The input data for the request
 * @returns The mutation result containing data and status
 *
 * @example
 * // Create a new payment
 * const { mutate, isLoading } = useAction('POST /payments', {
 *  amount: 1000,
 * date: '2023-01-01',
 * });
 */
export function useAction<E extends MutationEndpoints, TData>(
  endpoint: E,
  options: Omit<
    UseMutationOptions<TData, Endpoints[E]['error']>,
    'mutationFn' | 'mutationKey'
  > & {
    invalidate?: DataEndpoints[];
    mutationFn: MutationFunction<
      TData,
      (input: Endpoints[E]['input']) => Promise<Endpoints[E]['output']>
    >;
  },
) {
  const queryClient = useQueryClient();
  return useMutation({
    ...options,
    mutationKey: [endpoint],
    mutationFn: () => {
      return options.mutationFn(async (input: Endpoints[E]['input']) => {
        const [output, error] = await client.request(endpoint, input);
        if (error) {
          throw error;
        }
        return output;
      });
    },
    onSuccess: async (result, variables, context) => {
      for (const endpoint of options.invalidate ?? []) {
        await queryClient.invalidateQueries({
          predicate(query) {
            return query.meta?.endpoint === endpoint;
          },
        });
      }
      return options.onSuccess?.(result, variables, context);
    },
  });
}
```

</details>

## Examples

- Fetch data from the API using the `useData` hook.

```tsx
import { useData } from './api';

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
import { useAction, useData } from './api';

function CreatePaymentForm() {
  const [amount, setAmount] = useState(0);
  const [date, setDate] = useState('');

  // The second argument specifies which queries to invalidate after successful mutation
  const { mutate, isLoading, error } = useAction('POST /payments', {
    invalidate: ['GET /payments'], // This will invalidate the payments query
    mutationFn: async (dispatch) => {
      return dispatch({ amount, date });
    },
    onSuccess: (result) => {
      // Handle success
    },
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        mutate({ amount, date });
      }}
    >
      {/* Form fields */}
      <button type="submit" disabled={isLoading}>
        {isLoading ? 'Creating...' : 'Create Payment'}
      </button>
      {error && <p>Error: {error.message}</p>}
    </form>
  );
}
```
