import { z } from 'zod';

export const purgeConfirmSchema = z
  .object({
    confirm: z.literal('DELETE', {
      error: 'You must type DELETE to confirm',
    }),
  })
  .strict();

export default { purgeConfirmSchema };
