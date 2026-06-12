// Generic Zod validation middleware factory
export const validate = (schema) => (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
        return res.status(400).json({
            success: false,
            message: "Validation failed",
            errors: result.error.flatten().fieldErrors
        });
    }
    req.body = result.data; // use parsed/sanitized data
    next();
};
