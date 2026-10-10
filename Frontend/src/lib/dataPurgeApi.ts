import { api } from './api';

export interface PurgeResult {
  purged: boolean;
  category: string;
  counts: Record<string, number>;
}

export type PurgeCategory = 'menu' | 'tables' | 'kitchen' | 'customers' | 'reports';

export function purgeData(category: PurgeCategory): Promise<PurgeResult> {
  return api<PurgeResult>(`/api/data-purge/${category}`, {
    method: 'POST',
    body: { confirm: 'DELETE' },
  });
}
