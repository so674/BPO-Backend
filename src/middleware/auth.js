import { verifyToken } from "../utils/jwt.js";

// Verifies the human user's JWT (from /auth/login) and attaches req.user.
// Per Section 5.1: the backend MUST independently enforce authorization —
// the frontend hiding a button is not a security control.
export function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing or invalid Authorization header" });
  }
  const token = header.slice("Bearer ".length);
  try {
    req.user = verifyToken(token); // { id, role, employeeId, name }
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

// Restricts a route to a set of roles, e.g. requireRole("HR")
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ message: "Unauthorized: Authentication required" });
    }

    // Flatten array in case an array was passed: requireRole(["HR", "ADMIN"])
    const allowedRoles = roles.flat().map((r) => String(r).toUpperCase());
    const userRole = String(req.user.role || "").toUpperCase();

    if (!allowedRoles.includes(userRole)) {
      return res.status(403).json({ 
        message: `Forbidden: Access denied for role '${req.user.role}'` 
      });
    }

    next();
  };
}
