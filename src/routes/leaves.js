import express from 'express';
import {
  applyLeave,
  getEmployeeLeaves,
  getEmployeeBalance,
  approveLeave,
  rejectLeave,
  cancelLeave,
  getPendingLeaves,
  setOrUpdateBalance
} from '../controllers/leaveController.js';

const router = express.Router();

// Specific routes (MUST come before parametric /:id routes)
router.post('/apply', applyLeave);
router.get('/pending', getPendingLeaves);
router.post('/balance', setOrUpdateBalance);
router.get('/employee/:employee_id', getEmployeeLeaves);
router.get('/balance/:employee_id', getEmployeeBalance);

// Parametric ID routes
router.put('/:id/approve', approveLeave);
router.put('/:id/reject', rejectLeave);
router.put('/:id/cancel', cancelLeave);

export default router;