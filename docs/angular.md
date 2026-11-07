## Integrate with Angular

Use Angular 22's [`resource`](https://angular.dev/guide/signals/resource) function to fetch data and a thin wrapper to submit mutations.

> [!IMPORTANT]
> When generating the TypeScript client SDK within your Angular project or workspace, ensure you include the `--useTsExtension=false` flag. The code below uses an SDK generated with `--name MyApi`.

---

Copy the following code into your project.

- **`api.ts` file:**

<details>
<summary>View the API code</summary>

```ts
import {
  type PromiseResourceOptions,
  type Signal,
  computed,
  linkedSignal,
  resource,
} from '@angular/core';

import { type MyApiEndpoints as Endpoints, createMyApi } from '../client/src';

export const client = createMyApi({
  baseUrl: 'http://localhost:3000',
});

type DataEndpoints = {
  [K in keyof Endpoints]: K extends `${'GET'} ${string}` ? K : never;
}[keyof Endpoints];

type MutationEndpoints = {
  [
    K in keyof Endpoints
  ]: K extends `${'POST' | 'PUT' | 'PATCH' | 'DELETE'} ${string}` ? K : never;
}[keyof Endpoints];

type Paged<P> = {
  hasNextPage(): boolean;
  getNextPage(options?: { signal?: AbortSignal }): Promise<P>;
};

type PageEndpoints = {
  [K in DataEndpoints]: Endpoints[K]['result'] extends Paged<
    Endpoints[K]['result']
  >
    ? K
    : never;
}[DataEndpoints];

type RequestOptions = NonNullable<Parameters<typeof client.request>[2]>;

export function useData<E extends DataEndpoints>(
  endpoint: E,
  input?: Endpoints[E]['input'] | Signal<Endpoints[E]['input'] | undefined>,
  options?: Omit<
    PromiseResourceOptions<
      Endpoints[E]['result'],
      Endpoints[E]['input'] | undefined
    >,
    'loader' | 'params' | 'stream'
  > &
    Pick<RequestOptions, 'headers'>,
) {
  const { headers, ...resourceOptions } = options ?? {};
  const params: () => Endpoints[E]['input'] | undefined =
    typeof input === 'function'
      ? input
      : () => input ?? ({} as Endpoints[E]['input']);

  return resource<Endpoints[E]['result'], Endpoints[E]['input'] | undefined>({
    ...resourceOptions,
    params,
    loader: ({ abortSignal, params }) =>
      Promise.resolve(
        client.request(endpoint, params, {
          signal: abortSignal,
          headers,
        }),
      ),
  });
}

export function useInfiniteData<E extends PageEndpoints>(
  endpoint: E,
  input?: Endpoints[E]['input'] | Signal<Endpoints[E]['input'] | undefined>,
) {
  const first = useData(endpoint, input);
  const firstPage = computed(() =>
    first.hasValue() ? first.value() : undefined,
  );
  // A new first page starts the list again.
  const nextPages = linkedSignal({
    source: firstPage,
    computation: (): Endpoints[E]['result'][] => [],
  });
  const pages = computed(() => {
    const page = firstPage();
    return page ? [page, ...nextPages()] : [];
  });
  // PageEndpoints admits only endpoints whose result pages.
  const lastPage = computed(
    () => pages().at(-1) as Paged<Endpoints[E]['result']> | undefined,
  );
  const hasMore = computed(() => lastPage()?.hasNextPage() ?? false);

  async function loadMore() {
    const page = lastPage();
    if (!page?.hasNextPage()) return;
    const next = await page.getNextPage();
    // Drop the page if the list changed while it loaded.
    if (lastPage() === page) nextPages.update((pages) => [...pages, next]);
  }

  return { resource: first, pages, hasMore, loadMore };
}

export function useAction<E extends MutationEndpoints>(endpoint: E) {
  return {
    mutate: (input: Endpoints[E]['input']) => client.request(endpoint, input),
  };
}
```

</details>

## Examples

### `useData`

- Fetch a list of payments with static parameters:

```ts
import { Component } from '@angular/core';

import { useData } from './api';

@Component({
  selector: 'payments-list',
  template: `
    @if (paymentsResource.value(); as payments) {
      <ul>
        @for (payment of payments; track payment.id) {
          ...
        }
      </ul>
    }
  `,
})
export class PaymentsListComponent {
  paymentsResource = useData('GET /payments', {
    since: '2023-01-01',
    until: '2023-12-31',
  });
}
```

- With signals

```ts
import { Component, computed, signal } from '@angular/core';

import { useData } from './api';

@Component({
  // ...
})
export class FilteredPaymentsComponent {
  dateRange = signal({
    since: '2023-01-01',
    until: '2023-12-31',
  });

  // Pass the signal directly to useData
  paymentsResource = useData('GET /payments', this.dateRange);

  // Method to update the filter
  updateDateRange(since: string, until: string) {
    this.dateRange.set({ since, until });
  }
}
```

- Dependent queries

```ts
import { Component, computed, signal } from '@angular/core';

import { useData } from './api';

@Component({
  // ...
})
export class FilteredPaymentsComponent {
  // assuming we don't have initial id value
  id = signal<string | undefined>(undefined);

  paymentsResource = useData(
    'GET /payments/{id}',
    computed(() => {
      const id = this.id();
      return id ? { id } : undefined;
    }),
    // return undefined if id is not available so the request is not sent
  );

  selectChat(chat: { id: string }) {
    this.id.set(chat.id);
  }
}
```

### `useInfiniteData`

- Load a paginated endpoint page by page. Each page is the response body with the paging methods, so `loadMore()` fetches the next page with the last page's `getNextPage()`.

```ts
import { Component } from '@angular/core';

import { useInfiniteData } from './api';

@Component({
  selector: 'events-list',
  template: `
    <ul>
      @for (page of events.pages(); track $index) {
        @for (event of page.data; track event) {
          <li>{{ event }}</li>
        }
      }
    </ul>
    @if (events.hasMore()) {
      <button (click)="events.loadMore()">Load more</button>
    }
  `,
})
export class EventsListComponent {
  events = useInfiniteData('GET /events', { limit: 20 });
}
```

### `useAction` Use Cases

- Simple form submission

```ts
import { Component, inject, signal } from '@angular/core';
import { FormBuilder, Validators } from '@angular/forms';

import { useAction } from './api';

@Component({
  selector: 'app-payment-form',
  template: `<form [formGroup]="form" (ngSubmit)="submit()">...</form>`,
})
export class PaymentFormComponent {
  private formBuilder = inject(FormBuilder);

  form = this.formBuilder.nonNullable.group({
    amount: [0, [Validators.required, Validators.min(1)]],
    date: ['', Validators.required],
    description: [''],
  });
  isSubmitting = signal(false);

  // Simple action for creating a payment
  createPayment = useAction('POST /payments');

  async submit() {
    if (this.form.invalid) return;

    this.isSubmitting.set(true);

    try {
      await this.createPayment.mutate(this.form.getRawValue());
      this.form.reset();
    } catch (error) {
      console.error('Failed to create payment:', error);
    } finally {
      this.isSubmitting.set(false);
    }
  }
}
```

#### Update with Optimistic UI

```ts
import { Component, computed, input } from '@angular/core';

import { useAction, useData } from './api';

@Component({
  selector: 'app-payment-status',
  template: `<button (click)="updateStatus('COMPLETED')">
    Mark as Completed
  </button>`,
})
export class PaymentStatusComponent {
  // Get payment ID from component input
  paymentId = input.required<string>();

  // Fetch the payment data
  paymentResource = useData(
    'GET /payments/{id}',
    computed(() => ({ id: this.paymentId() })),
  );

  // Action for updating payment status
  updatePaymentStatus = useAction('PATCH /payments/{id}/status');

  async updateStatus(newStatus: string) {
    // Get the current payment
    const currentPayment = this.paymentResource.value();
    if (!currentPayment) return;

    // Optimistically update the UI
    this.paymentResource.update((payment) =>
      payment
        ? {
            ...payment,
            status: newStatus,
          }
        : payment,
    );

    try {
      await this.updatePaymentStatus.mutate({
        id: this.paymentId(),
        status: newStatus,
      });
    } catch (error) {
      // The SDK throws on failed responses, so restore the previous value.
      this.paymentResource.set(currentPayment);
      console.error('Failed to update payment:', error);
    }
  }
}
```
