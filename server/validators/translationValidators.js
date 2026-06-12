import { z } from 'zod';

export const translationSchema = z.object({
    text: z.string()
        .min(1, 'Text to translate cannot be empty')
        .max(3000, 'Text too long — max 3000 characters')
        .transform(val => val.trim()),

    direction: z.enum(['tv_to_en', 'en_to_tv'], {
        errorMap: () => ({ message: 'direction must be "tv_to_en" or "en_to_tv"' }),
    }),
});
