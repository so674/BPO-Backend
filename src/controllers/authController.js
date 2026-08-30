import bcrypt from "bcryptjs";
import { z } from "zod";
import { query } from "../config/db.js";
import { signToken } from "../utils/jwt.js";
import { ApiError } from "../middleware/errorHandler.js";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

// Section 23.1: User → Authentication → Role → Permission → Authorized Action → Audit
export async function login(req, res) {
  const { email, password } = loginSchema.parse(req.body);

  const { rows } = await query("SELECT * FROM users WHERE email = ?", [email]);
  const user = rows[0];

  // Deliberately vague error so we don't reveal whether the email exists
  if (!user) throw new ApiError(401, "Invalid email or password");

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) throw new ApiError(401, "Invalid email or password");

  const token = signToken({
    id: user.id,
    name: user.name,
    role: user.role,
    employeeId: user.employee_id,
  });

  res.json({
    token,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      employeeId: user.employee_id,
    },
  });
}

// Returns the currently authenticated user — useful for the frontend to
// restore a session on page reload from a stored token.
export async function me(req, res) {
  res.json({ user: req.user });
}
