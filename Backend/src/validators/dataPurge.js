import { z } from 'zod';

export const purgeConfirmSchema = z
  .object({
    confirm: z.literal('DELETE', {
      errorMap: () => ({ message: 'You must type DELETE to confirm' }),
    }),
  })
  .strict();

export default { purgeConfirmSchema };
