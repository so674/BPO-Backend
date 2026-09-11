import bcrypt from "bcryptjs";
import { z } from "zod";
import { query } from "../config/db.js";
import { signToken, verifyToken } from "../utils/jwt.js";
import { ApiError } from "../middleware/errorHandler.js";

// Validation Schemas
const loginSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(1, "Password is required"),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required"),
  newPassword: z.string().min(6, "New password must be at least 6 characters"),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(1, "Refresh token is required"),
});

/**
 * Helper to safely extract rows array from MySQL result wrapper
 * @param {object|array} result - Database query result
 * @returns {array} Array of row objects
 */
function getRows(result) {
  if (!result) return [];
  if (Array.isArray(result)) {
    return Array.isArray(result[0]) ? result[0] : result;
  }
  return result.rows || [];
}

/**
 * Helper to handle validation and operational errors securely without leaking sensitive info
 * @param {Error} error - Caught error object
 * @param {object} res - Express response object
 * @returns {object} Express JSON response
 */
function handleAuthError(error, res) {
  if (error instanceof z.ZodError) {
    const issue = error.issues[0];
    return res.status(400).json({ error: issue ? issue.message : "Invalid input payload" });
  }

  if (error instanceof ApiError) {
    return res.status(error.statusCode || 400).json({ error: error.message });
  }

  console.error("[AUTH ERROR]:", error.message);
  return res.status(500).json({ error: "Authentication processing failed" });
}

/**
 * POST /api/auth/login
 * Authenticates user credentials and issues JWT access and refresh tokens.
 */
export async function login(req, res) {
  try {
    const { email, password } = loginSchema.parse(req.body);

    const dbResult = await query("SELECT * FROM users WHERE email = ?", [email]);
    const rows = getRows(dbResult);
    const user = rows[0];

    // Generic error response prevents account enumeration attacks
    if (!user) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    if (user.status && user.status !== "ACTIVE") {
      return res.status(403).json({ error: "Account is inactive" });
    }

    const token = signToken({
      id: user.id,
      name: user.name,
      role: user.role,
      employeeId: user.employee_id,
    });

    const refreshToken = signToken(
      { id: user.id, type: "refresh" },
      { expiresIn: "7d" }
    );

    return res.json({
      token,
      refreshToken,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        employeeId: user.employee_id,
      },
    });
  } catch (error) {
    return handleAuthError(error, res);
  }
}

/**
 * GET /api/auth/me
 * Retrieves current authenticated user profile.
 */
export async function me(req, res) {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthenticated" });
    }
    return res.json({ user: req.user });
  } catch (error) {
    return handleAuthError(error, res);
  }
}

/**
 * POST /api/auth/logout
 * Clears authentication state on the client side.
 */
export async function logout(req, res) {
  return res.json({ message: "Logged out successfully" });
}

/**
 * POST /api/auth/refresh
 * Generates a new access token using a valid refresh token.
 */
export async function refreshToken(req, res) {
  try {
    const { refreshToken: tokenInput } = refreshSchema.parse(req.body);

    const decoded = verifyToken(tokenInput);
    if (!decoded || decoded.type !== "refresh") {
      return res.status(401).json({ error: "Invalid or expired refresh token" });
    }

    const dbResult = await query("SELECT * FROM users WHERE id = ?", [decoded.id]);
    const rows = getRows(dbResult);
    const user = rows[0];

    if (!user || (user.status && user.status !== "ACTIVE")) {
      return res.status(401).json({ error: "User no longer active or exists" });
    }

    const newToken = signToken({
      id: user.id,
      name: user.name,
      role: user.role,
      employeeId: user.employee_id,
    });

    return res.json({ token: newToken });
  } catch (error) {
    return handleAuthError(error, res);
  }
}

/**
 * POST /api/auth/change-password
 * Updates password hash for currently authenticated user.
 */
export async function changePassword(req, res) {
  try {
    const { currentPassword, newPassword } = changePasswordSchema.parse(req.body);
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: "Unauthenticated" });
    }

    const dbResult = await query("SELECT * FROM users WHERE id = ?", [userId]);
    const rows = getRows(dbResult);
    const user = rows[0];

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const valid = await bcrypt.compare(currentPassword, user.password_hash);
    if (!valid) {
      return res.status(400).json({ error: "Incorrect current password" });
    }

    const newHash = await bcrypt.hash(newPassword, 10);
    await query("UPDATE users SET password_hash = ? WHERE id = ?", [newHash, userId]);

    return res.json({ message: "Password updated successfully" });
  } catch (error) {
    return handleAuthError(error, res);
  }
}