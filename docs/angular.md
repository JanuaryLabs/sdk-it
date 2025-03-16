## Integrate with Angular

This integration builds on Angular's [`resource`](https://angular.dev/guide/signals/resource) function for fetching data and simple wrapper for submitting data to the server.

> [!IMPORTANT]
> When generating the client SDK within your Angular project or workspace, ensure you include the `--useTsExtension=false` flag.

---

Copy the following code into your project.

- **`api.ts` file:**

<details>
<summary>View the API code</summary>

```ts
import {
  type PromiseResourceOptions,
  type Signal,
  isSignal,
  resource,
} from '@angular/core';
import { FormGroup } from '@angular/forms';

import { Client, type Endpoints } from '../client/src';

export const client = new Client({
  baseUrl: 'http://localhost:3000',
});

type DataEndpoints = {
  [K in keyof Endpoints]: K extends `${'GET'} ${string}` ? K : never;
}[keyof Endpoints];

type MutationEndpoints = {
  [K in keyof Endpoints]: K extends `${'POST' | 'PUT' | 'PATCH' | 'DELETE'} ${string}`
    ? K
    : never;
}[keyof Endpoints];

export function useData<E extends DataEndpoints>(
  endpoint: E,
  input?: Endpoints[E]['input'] | Signal<Endpoints[E]['input'] | undefined>,
  options?: Omit<
    PromiseResourceOptions<
      readonly [Endpoints[E]['output'], Endpoints[E]['error'] | null],
      typeof input
    >,
    'request' | 'loader' | 'stream'
  > & { headers?: HeadersInit },
) {
  return resource({
    ...options,
    request: isSignal(input) ? () => input() : () => input,
    loader: async ({ abortSignal, previous, request }) => {
      const input = isSignal(request) ? request() : (request ?? ({} as never));
      return client.request(endpoint, input ?? ({} as never), {
        signal: abortSignal,
        headers: options?.headers,
      });
    },
  });
}

export function useAction<E extends MutationEndpoints>(endpoint: E) {
  return {
    mutate: (
      input:
        | Endpoints[E]['input']
        | Signal<Endpoints[E]['input']>
        | { value: Endpoints[E]['input'] },
    ) => {
      const payload = isSignal(input)
        ? input()
        : input instanceof FormGroup
          ? input.value
          : input;
      return client.request(endpoint, payload);
    },
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
    @if (paymentsResource.value()?.[0]; as result) {
      <ul>
        @for (payment of result; track payment.id) {
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
    computed(() => (this.id() ? { id: this.id() } : undefined)),
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
import { Component } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';

import { useAction } from './api';

@Component({
  selector: 'app-payment-form',
  template: `<form [formGroup]="form" (ngSubmit)="submit()">...</form>`,
})
export class PaymentFormComponent {
  form: FormGroup;
  isSubmitting = signal(false);

  // Simple action for creating a payment
  createPayment = useAction('POST /payments');

  constructor(private fb: FormBuilder) {
    this.form = this.fb.group({
      amount: [null, [Validators.required, Validators.min(1)]],
      date: [null, Validators.required],
      description: [''],
    });
  }

  async submit() {
    if (this.form.invalid) return;

    this.isSubmitting.set(true);

    try {
      const [result, error] = await this.createPayment.mutate(this.form);

      if (error) {
        // Handle error
        console.error('Failed to create payment:', error);
      } else {
        // Handle success
        this.form.reset();
      }
    } finally {
      this.isSubmitting.set(false);
    }
  }
}
```

#### Update with Optimistic UI

```ts
import { Component, input } from '@angular/core';

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
  paymentResource = useData('GET /payments/{id}', () => ({
    id: this.paymentId(),
  }));

  // Action for updating payment status
  updatePaymentStatus = useAction('PATCH /payments/{id}/status');

  async updateStatus(newStatus: string) {
    // Get the current payment
    const currentPayment = this.paymentResource.value?.[0];
    if (!currentPayment) return;

    // Store original status for rollback
    const originalStatus = currentPayment.status;

    // Optimistically update the UI
    this.paymentResource.set(([payment, error]) => {
      if (!payment) return [payment, error];

      const updatedPayment = {
        ...payment,
        status: newStatus,
      };

      return [updatedPayment, error];
    });

    // Send the actual update to the server
    const [result, error] = await this.updatePaymentStatus.mutate({
      id: this.paymentId(),
      status: newStatus,
    });

    // If there was an error, roll back the optimistic update
    if (error) {
      this.paymentResource.mutate(([payment, _]) => {
        if (!payment) return [payment, error];

        return [{ ...payment, status: originalStatus }, error];
      });
    }
  }
}
```
