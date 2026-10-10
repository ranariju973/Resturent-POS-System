import { z } from 'zod';
const purgeConfirmSchema = z.object({
  confirm: z.literal('DELETE', {
    errorMap: () => ({ message: 'You must type DELETE to confirm' }),
  }),
}).strict();
try {
  console.log(purgeConfirmSchema.parse({ confirm: 'DELETE' }));
} catch (e) {
  console.log(e);
}
