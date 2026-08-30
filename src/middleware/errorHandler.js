// Catches anything thrown in a route (including async ones, thanks to express-async-errors)
// and returns a controlled, consistent error shape instead of leaking stack traces.
export function errorHandler(err, req, res, next) {
  console.error(err);

  if (err.name === "ZodError") {
    return res.status(400).json({ error: "Invalid request data", details: err.issues });
  }

  if (err.code === "ER_DUP_ENTRY" || err.errno === 1062) {
    // MySQL unique_violation — e.g. duplicate employee code, email, or card UID
    return res.status(409).json({ error: "A record with this value already exists" });
  }

  if (err.code === "ER_NO_REFERENCED_ROW_2" || err.errno === 1452) {
    // MySQL foreign-key violation — e.g. department/shift/manager id that doesn't exist
    return res.status(400).json({ error: "One of the referenced records (department, shift, or manager) does not exist" });
  }

  const status = err.status || 500;
  const message = status === 500 ? "Internal server error" : err.message;
  res.status(status).json({ error: message });
}

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
