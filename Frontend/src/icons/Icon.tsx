import { Icon as IconifyIcon, addCollection } from '@iconify/react';
import { lucideSubset } from './data';

addCollection(lucideSubset);

export function Icon({ icon, size = 16, color }: { icon: string; size?: number; color?: string }) {
  return <IconifyIcon icon={icon} width={size} height={size} color={color} />;
}
