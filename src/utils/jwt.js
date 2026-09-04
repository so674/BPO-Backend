import jwt from "jsonwebtoken";
import "dotenv/config";

const SECRET = process.env.JWT_SECRET;
const EXPIRES_IN = process.env.JWT_EXPIRES_IN || "8h";

const JWT_ALGORITHM = "HS256";

// ------------------------------------------------------------
// Production safety check
// ------------------------------------------------------------

if (!SECRET) {
  throw new Error(
    "JWT_SECRET is missing. Add a strong JWT_SECRET to your .env file.",
  );
}

if (SECRET.length < 32) {
  throw new Error(
    "JWT_SECRET must be at least 32 characters long.",
  );
}

// ------------------------------------------------------------
// Create JWT
// ------------------------------------------------------------

export function signToken(payload) {
  return jwt.sign(payload, SECRET, {
    algorithm: JWT_ALGORITHM,
    expiresIn: EXPIRES_IN,
  });
}

// ------------------------------------------------------------
// Verify JWT
// ------------------------------------------------------------

export function verifyToken(token) {
  return jwt.verify(token, SECRET, {
    algorithms: [JWT_ALGORITHM],
  });
}