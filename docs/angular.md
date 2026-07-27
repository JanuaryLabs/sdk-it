## Integrate with Angular

Use Angular 22's [`resource`](https://angular.dev/guide/signals/resource) function to fetch data and a thin wrapper to submit mutations.

> [!IMPORTANT]
> When generating the TypeScript client SDK within your Angular project or workspace, ensure you include the `--useTsExtension=false` flag.

---

Copy the following code into your project.

- **`api.ts` file:**

<details>
<summary>View the API code</summary>

```ts
import {
  type PromiseResourceOptions,
  type Signal,
  resource,
} from '@angular/core';

import { Client, type Endpoints } from '../client/src';

export const client = new Client({
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

type RequestOptions = NonNullable<Parameters<Client['request']>[2]>;

export function useData<E extends DataEndpoints>(
  endpoint: E,
  input?: Endpoints[E]['input'] | Signal<Endpoints[E]['input'] | undefined>,
  options?: Omit<
    PromiseResourceOptions<
      Endpoints[E]['output'],
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

  return resource<Endpoints[E]['output'], Endpoints[E]['input'] | undefined>({
    ...resourceOptions,
    params,
    loader: ({ abortSignal, params }) =>
      client.request(endpoint, params, {
        signal: abortSignal,
        headers,
      }),
  });
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
