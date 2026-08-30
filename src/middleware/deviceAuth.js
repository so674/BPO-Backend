// Per Section 22.2: "Device credentials MUST be separate from human-user credentials."
// Readers/adapters authenticate with a shared device API key in a custom header,
// never with a human JWT.
export function requireDeviceAuth(req, res, next) {
  const key = req.headers["x-device-api-key"];
  if (!key || key !== process.env.DEVICE_API_KEY) {
    return res.status(401).json({ error: "Invalid or missing device credentials" });
  }
  next();
}
