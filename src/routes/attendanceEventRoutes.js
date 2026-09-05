import express from 'express';
import { ingestEvent, listEvents } from '../controllers/attendanceEventController.js';
// Import your authentication/authorization middleware if active
// import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// RFID Hardware Punch Endpoint
router.post('/ingest', ingestEvent);

// Event History List (Requires Auth User context for RBAC)
router.get('/', listEvents);

export default router;