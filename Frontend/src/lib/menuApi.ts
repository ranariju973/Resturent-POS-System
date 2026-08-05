/**
 * Menu and category endpoints.
 *
 * Item writes go up as multipart because the image rides along with the
 * fields. That is also why numbers are appended as strings — a multipart body
 * has no types, and the server's schema coerces them back. Sending JSON works
 * too when there is no image, but using one path for both means only one path
 * is ever exercised.
 *
 * Prices are sent in MAJOR units ("4.25"). The server converts to minor units
 * at its validator and never trusts a client-supplied minor value.
 */
import { api } from './api';
import type { CategoryDto, MenuItemDto } from './dto';
import { toCategory, toMenuItem } from './dto';
import type { Category, MenuItem } from '../data/types';

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export async function listCategories(signal?: AbortSignal): Promise<Category[]> {
  const data = await api<{ categories: CategoryDto[] }>('/api/menu/categories', { signal });
  return data.categories.map(toCategory);
}

export async function createCategory(input: {
  name: string;
  color: string;
  sortOrder?: number;
}): Promise<Category> {
  const data = await api<{ category: CategoryDto }>('/api/menu/categories', {
    method: 'POST',
    body: input,
  });
  return toCategory(data.category);
}

export async function updateCategory(
  id: string,
  input: { name?: string; color?: string; sortOrder?: number },
): Promise<Category> {
  const data = await api<{ category: CategoryDto }>(`/api/menu/categories/${id}`, {
    method: 'PUT',
    body: input,
  });
  return toCategory(data.category);
}

/**
 * Soft delete. The server refuses (409) while live items still reference the
 * category, so the UI must surface the message rather than assume success.
 */
export async function deleteCategory(id: string): Promise<void> {
  await api<{ deleted: boolean; id: string }>(`/api/menu/categories/${id}`, { method: 'DELETE' });
}

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

export interface ListItemsFilter {
  category?: string;
  available?: boolean;
  search?: string;
  includeInactive?: boolean;
}

export async function listItems(
  filter: ListItemsFilter = {},
  signal?: AbortSignal,
): Promise<MenuItem[]> {
  const qs = new URLSearchParams();
  if (filter.category) qs.set('category', filter.category);
  if (filter.available !== undefined) qs.set('available', String(filter.available));
  if (filter.search) qs.set('search', filter.search);
  if (filter.includeInactive) qs.set('includeInactive', 'true');

  const suffix = qs.toString() ? `?${qs}` : '';
  const data = await api<{ items: MenuItemDto[] }>(`/api/menu/items${suffix}`, { signal });
  return data.items.map(toMenuItem);
}

export interface ItemInput {
  name: string;
  /** Major units, at most two decimals — "4.25", not 425. */
  price: string;
  category: string;
  description?: string;
  available?: boolean;
  image?: File | null;
  /** Clear the existing image without uploading a replacement. */
  removeImage?: boolean;
}

function itemFormData(input: Partial<ItemInput>): FormData {
  const form = new FormData();
  if (input.name !== undefined) form.set('name', input.name);
  if (input.price !== undefined) form.set('price', input.price);
  if (input.category !== undefined) form.set('category', input.category);
  if (input.description !== undefined) form.set('description', input.description);
  if (input.available !== undefined) form.set('available', String(input.available));
  if (input.removeImage) form.set('removeImage', 'true');
  if (input.image) form.set('image', input.image);
  return form;
}

export async function createItem(input: ItemInput): Promise<MenuItem> {
  const data = await api<{ item: MenuItemDto }>('/api/menu/items', {
    method: 'POST',
    body: itemFormData(input),
  });
  return toMenuItem(data.item);
}

export async function updateItem(id: string, input: Partial<ItemInput>): Promise<MenuItem> {
  const data = await api<{ item: MenuItemDto }>(`/api/menu/items/${id}`, {
    method: 'PUT',
    body: itemFormData(input),
  });
  return toMenuItem(data.item);
}

/**
 * The stock toggle — the one menu write a cashier holds. Deliberately its own
 * endpoint with a single-boolean body, so it cannot be used to smuggle a price
 * change through.
 */
export async function setAvailability(id: string, available: boolean): Promise<MenuItem> {
  const data = await api<{ item: MenuItemDto }>(`/api/menu/items/${id}/availability`, {
    method: 'PATCH',
    body: { available },
  });
  return toMenuItem(data.item);
}

/** Soft delete. The row survives so past orders keep resolving. */
export async function deleteItem(id: string): Promise<void> {
  await api<{ deleted: boolean; id: string }>(`/api/menu/items/${id}`, { method: 'DELETE' });
}

/**
 * Permanent deletion. Admin-only, and the server refuses with 409 if the item
 * has ever appeared on an order — so callers must treat a conflict as the
 * expected answer rather than a failure, and fall back to the soft delete.
 */
export async function purgeItem(id: string): Promise<void> {
  await api<{ purged: boolean; id: string }>(`/api/menu/items/${id}/purge`, { method: 'DELETE' });
}
