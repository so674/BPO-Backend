import bcrypt from "bcryptjs";
import { z } from "zod";
import { query } from "../config/db.js";
import { signToken, verifyToken } from "../utils/jwt.js";
import { ApiError } from "../middleware/errorHandler.js";

// Validation Schemas
const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(6, "New password must be at least 6 characters"),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

// 1. POST /api/auth/login
export async function login(req, res) {
  const { email, password } = loginSchema.parse(req.body);

  const { rows } = await query("SELECT * FROM users WHERE email = ?", [email]);
  const user = rows[0];

  // Deliberately vague error so we don't reveal whether the email exists
  if (!user) throw new ApiError(401, "Invalid email or password");

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) throw new ApiError(401, "Invalid email or password");

  if (user.status && user.status !== "ACTIVE") {
    throw new ApiError(403, "Account is inactive");
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

  res.json({
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
}

// 2. GET /api/auth/me
// Returns the currently authenticated user — useful for the frontend to
// restore a session on page reload from a stored token.
export async function me(req, res) {
  if (!req.user) {
    throw new ApiError(401, "Unauthenticated");
  }
  res.json({ user: req.user });
}

// 3. POST /api/auth/logout
export async function logout(req, res) {
  // Statetess JWT logout confirmation
  res.json({ message: "Logged out successfully" });
}

// 4. POST /api/auth/refresh
export async function refreshToken(req, res) {
  const { refreshToken } = refreshSchema.parse(req.body);

  const decoded = verifyToken(refreshToken);
  if (!decoded || decoded.type !== "refresh") {
    throw new ApiError(401, "Invalid or expired refresh token");
  }

  const { rows } = await query("SELECT * FROM users WHERE id = ?", [decoded.id]);
  const user = rows[0];

  if (!user || (user.status && user.status !== "ACTIVE")) {
    throw new ApiError(401, "User no longer active or exists");
  }

  const newToken = signToken({
    id: user.id,
    name: user.name,
    role: user.role,
    employeeId: user.employee_id,
  });

  res.json({ token: newToken });
}

// 5. POST /api/auth/change-password
export async function changePassword(req, res) {
  const { currentPassword, newPassword } = changePasswordSchema.parse(req.body);
  const userId = req.user.id;

  const { rows } = await query("SELECT * FROM users WHERE id = ?", [userId]);
  const user = rows[0];

  if (!user) throw new ApiError(404, "User not found");

  const valid = await bcrypt.compare(currentPassword, user.password_hash);
  if (!valid) throw new ApiError(400, "Incorrect current password");

  const newHash = await bcrypt.hash(newPassword, 10);
  await query("UPDATE users SET password_hash = ? WHERE id = ?", [newHash, userId]);

  res.json({ message: "Password updated successfully" });
}