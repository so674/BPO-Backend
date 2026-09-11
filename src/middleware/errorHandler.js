/**
 * Custom operational API Error class for throwing HTTP-friendly errors with status codes.
 */
export class ApiError extends Error {
  /**
   * @param {number} status - HTTP status code (e.g., 400, 401, 404, 403)
   * @param {string} message - User-friendly error message
   */
  constructor(status, message) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.statusCode = status;
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Global Express error handling middleware.
 * Intercepts all synchronous and asynchronous route errors, sanitizes error output,
 * and prevents sensitive database stack traces or internal details from leaking.
 *
 * @param {Error & { status?: number, statusCode?: number, code?: string, errno?: number, issues?: Array<object> }} err - Express error object
 * @param {import('express').Request} req - Express request object
 * @param {import('express').Response} res - Express response object
 * @param {import('express').NextFunction} next - Express next function
 */
export function errorHandler(err, req, res, next) {
  const isProduction = process.env.NODE_ENV === "production";
  const statusCode = err.status || err.statusCode || 500;

  // 1. Structured Server Logging (Preserves full stack trace internally for debugging)
  console.error(
    `[ERROR] ${new Date().toISOString()} - ${req.method} ${req.originalUrl || req.url}:`,
    isProduction ? err.message : err.stack || err
  );

  // 2. Handle Zod Input Validation Errors
  if (err.name === "ZodError") {
    return res.status(400).json({
      error: "Invalid request data",
      details: err.issues || []
    });
  }

  // 3. Handle MySQL Unique Constraint Violations (Duplicate entry)
  if (err.code === "ER_DUP_ENTRY" || err.errno === 1062) {
    return res.status(409).json({
      error: "A record with this value already exists"
    });
  }

  // 4. Handle MySQL Foreign Key Violations
  if (err.code === "ER_NO_REFERENCED_ROW_2" || err.errno === 1452 || err.code === "ER_ROW_IS_REFERENCED_2" || err.errno === 1451) {
    return res.status(400).json({
      error: "One of the referenced records (department, shift, manager, or employee) does not exist or is constrained"
    });
  }

  // 5. Handle Custom Operational ApiErrors
  if (err instanceof ApiError) {
    return res.status(err.status).json({
      error: err.message
    });
  }

  // 6. Generic Error Sanitization (Suppresses raw SQL/Internal error messages on 500 errors or production)
  const clientMessage = isProduction && statusCode === 500
    ? "An internal server error occurred"
    : err.message || "An unexpected error occurred";

  return res.status(statusCode).json({
    error: clientMessage
  });
}