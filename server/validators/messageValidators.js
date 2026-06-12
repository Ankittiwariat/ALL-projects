import { z } from 'zod';

export const textMessageSchema = z.object({
    chatId: z.string().min(1, "Chat ID required").regex(/^[a-f\d]{24}$/i, "Invalid Chat ID"),
    prompt: z.string()
        .min(1, "Prompt cannot be empty")
        .max(2000, "Prompt too long — max 2000 characters")
        .transform(val => val.trim()),
});

export const imageMessageSchema = z.object({
    chatId: z.string().min(1, "Chat ID required").regex(/^[a-f\d]{24}$/i, "Invalid Chat ID"),
    prompt: z.string()
        .min(1, "Prompt cannot be empty")
        .max(1000, "Prompt too long — max 1000 characters")
        .transform(val => val.trim()),
    isPublished: z.boolean().default(false),
});

export const chatDeleteSchema = z.object({
    chatId: z.string().min(1).regex(/^[a-f\d]{24}$/i, "Invalid Chat ID"),
});
