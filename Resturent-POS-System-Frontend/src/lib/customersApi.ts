/**
 * Customer endpoints.
 *
 * ── The lookup is the interesting one ──────────────────────────────────────
 * `lookupByPhone` resolves a number to a name so the till can auto-fill a
 * returning customer. That makes it a PII endpoint, and the server treats it
 * as one: exact full-number matching only, a per-user rate limit, and a
 * response containing nothing but a flag, an id and a name.
 *
 * The client's obligation is to not hammer it. Callers must debounce and pass
 * an AbortSignal, so a cashier typing a ten-digit number sends one request
 * rather than ten — otherwise the rate limit fires during ordinary use, which
 * would be read as a broken screen rather than as a working control.
 */
import { api } from './api';
import type { Customer } from '../data/types';
import type { CustomerDto } from './dto';
import { toCustomer } from './dto';

export interface PhoneMatch {
  found: boolean;
  id?: string;
  name?: string;
}

export async function lookupByPhone(phone: string, signal?: AbortSignal): Promise<PhoneMatch> {
  return api<PhoneMatch>(`/api/customers/lookup?phone=${encodeURIComponent(phone)}`, { signal });
}

export async function listCustomers(
  filter: { search?: string; limit?: number } = {},
  signal?: AbortSignal,
): Promise<Customer[]> {
  const qs = new URLSearchParams();
  if (filter.search) qs.set('search', filter.search);
  qs.set('limit', String(filter.limit ?? 50));

  const data = await api<{ customers: CustomerDto[] }>(`/api/customers?${qs}`, { signal });
  return data.customers.map(toCustomer);
}

export async function updateCustomer(
  id: string,
  input: { name?: string; phone?: string; email?: string; notes?: string },
): Promise<Customer> {
  const data = await api<{ customer: CustomerDto }>(`/api/customers/${id}`, {
    method: 'PUT',
    body: input,
  });
  return toCustomer(data.customer);
}

/**
 * Remove a customer. Admin only.
 *
 * Two levels, and they are not the same thing. The default hides the record
 * but keeps it recoverable; `erase` irreversibly anonymises the personal data
 * for a DPDP/GDPR request and additionally requires `user:manage`.
 */
export async function deleteCustomer(id: string, erase = false): Promise<void> {
  const suffix = erase ? '?erase=true' : '';
  await api<{ deleted?: boolean; erased?: boolean; id: string }>(
    `/api/customers/${id}${suffix}`,
    { method: 'DELETE' },
  );
}
