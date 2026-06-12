/**
 * Global error handler middleware.
 * Must be registered LAST in server.js (after all routes).
 * Catches any error passed via next(err) or thrown in async handlers.
 */
export const errorHandler = (err, req, res, next) => {
    // Log for server visibility (in production, pipe to your logger / APM)
    console.error(`[${new Date().toISOString()}] ${req.method} ${req.url} — ${err.message}`);

    const status = err.status || err.statusCode || 500;

    // Don't leak stack traces to clients in production
    const message =
        process.env.NODE_ENV === 'production' && status === 500
            ? 'An internal server error occurred'
            : err.message || 'Something went wrong';

    return res.status(status).json({ success: false, message });
};
