import { z } from 'zod';

export const registerSchema = z.object({
    name: z
        .string({ required_error: "Name is required" })
        .min(2, "Name must be at least 2 characters")
        .max(50, "Name must be at most 50 characters")
        .trim(),
    email: z
        .string({ required_error: "Email is required" })
        .email("Invalid email format")
        .toLowerCase()
        .trim(),
    password: z
        .string({ required_error: "Password is required" })
        .min(8, "Password must be at least 8 characters")
        .max(128, "Password too long")
        .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
        .regex(/[0-9]/, "Password must contain at least one number"),
});

export const loginSchema = z.object({
    email: z
        .string({ required_error: "Email is required" })
        .email("Invalid email format")
        .toLowerCase()
        .trim(),
    password: z
        .string({ required_error: "Password is required" })
        .min(1, "Password is required"),
});
