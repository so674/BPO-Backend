import db from '../config/db.js';
import { randomUUID } from 'crypto';

// 1. Submit a leave request
export const applyLeave = async (req, res) => {
  const { employee_id, leave_type, start_date, end_date, reason } = req.body;

  if (!employee_id || !leave_type || !start_date || !end_date) {
    return res.status(400).json({ error: 'employee_id, leave_type, start_date, and end_date are required' });
  }

  const start = new Date(start_date);
  const end = new Date(end_date);

  if (end < start) {
    return res.status(400).json({ error: 'End date cannot be prior to start date' });
  }

  const requestedDays = Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1;
  const year = start.getFullYear();

  try {
    const [balances] = await db.query(
      `SELECT allocated_days, used_days 
       FROM leave_balances 
       WHERE employee_id = ? AND leave_type = ? AND year = ?`,
      [employee_id, leave_type, year]
    );

    if (balances.length === 0) {
      return res.status(400).json({ error: `No leave balance allocated for ${leave_type} in ${year}` });
    }

    const { allocated_days, used_days } = balances[0];
    const remainingDays = allocated_days - used_days;

    if (requestedDays > remainingDays) {
      return res.status(400).json({ 
        error: `Insufficient leave balance. Requested: ${requestedDays}, Remaining: ${remainingDays}` 
      });
    }

    const requestId = randomUUID();

    await db.query(
      `INSERT INTO leave_requests (id, employee_id, leave_type, start_date, end_date, reason, status) 
       VALUES (?, ?, ?, ?, ?, ?, 'PENDING')`,
      [requestId, employee_id, leave_type, start_date, end_date, reason || null]
    );

    res.status(201).json({
      message: 'Leave request submitted successfully',
      requestId,
      requestedDays,
      remainingDays
    });
  } catch (error) {
    console.error('Error applying for leave:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

// 2. Get leave history for a specific employee
export const getEmployeeLeaves = async (req, res) => {
  const { employee_id } = req.params;

  try {
    const [requests] = await db.query(
      `SELECT * FROM leave_requests WHERE employee_id = ? ORDER BY created_at DESC`,
      [employee_id]
    );

    res.json({ requests });
  } catch (error) {
    console.error('Error fetching employee leaves:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

// 3. Get leave balances for a specific employee
export const getEmployeeBalance = async (req, res) => {
  const { employee_id } = req.params;
  const year = req.query.year || new Date().getFullYear();

  try {
    const [balances] = await db.query(
      `SELECT leave_type, allocated_days, used_days, (allocated_days - used_days) AS remaining_days 
       FROM leave_balances 
       WHERE employee_id = ? AND year = ?`,
      [employee_id, year]
    );

    res.json({ year: Number(year), balances });
  } catch (error) {
    console.error('Error fetching leave balance:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

// 4. Approve a leave request
export const approveLeave = async (req, res) => {
  const { id } = req.params;
  const { approved_by } = req.body;

  try {
    const [requests] = await db.query('SELECT * FROM leave_requests WHERE id = ?', [id]);
    if (requests.length === 0) {
      return res.status(404).json({ error: 'Leave request not found' });
    }

    const request = requests[0];
    if (request.status !== 'PENDING') {
      return res.status(400).json({ error: `Cannot approve a request that is currently '${request.status}'` });
    }

    const start = new Date(request.start_date);
    const end = new Date(request.end_date);
    const requestedDays = Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1;
    const year = start.getFullYear();

    await db.query(
      `UPDATE leave_balances 
       SET used_days = used_days + ? 
       WHERE employee_id = ? AND leave_type = ? AND year = ?`,
      [requestedDays, request.employee_id, request.leave_type, year]
    );

    await db.query(
      `UPDATE leave_requests 
       SET status = 'APPROVED', approved_by = ? 
       WHERE id = ?`,
      [approved_by || null, id]
    );

    res.json({ message: 'Leave request approved successfully' });
  } catch (error) {
    console.error('Error approving leave:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

// 5. Get all pending leave requests (HR / Manager View)
export const getPendingLeaves = async (req, res) => {
  try {
    const [requests] = await db.query(
      `SELECT r.*, e.first_name, e.last_name, e.department_id 
       FROM leave_requests r
       LEFT JOIN employees e ON r.employee_id = e.employee_code OR r.employee_id = e.id
       WHERE r.status = 'PENDING'
       ORDER BY r.created_at ASC`
    );

    res.json({ count: requests.length, requests });
  } catch (error) {
    console.error('Error fetching pending leaves:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

// 6. Reject a leave request
export const rejectLeave = async (req, res) => {
  const { id } = req.params;
  const { rejected_by } = req.body;

  try {
    const [requests] = await db.query('SELECT * FROM leave_requests WHERE id = ?', [id]);
    if (requests.length === 0) {
      return res.status(404).json({ error: 'Leave request not found' });
    }

    const request = requests[0];
    if (request.status !== 'PENDING') {
      return res.status(400).json({ error: `Cannot reject a request that is currently '${request.status}'` });
    }

    await db.query(
      `UPDATE leave_requests 
       SET status = 'REJECTED', approved_by = ? 
       WHERE id = ?`,
      [rejected_by || null, id]
    );

    res.json({ message: 'Leave request rejected successfully' });
  } catch (error) {
    console.error('Error rejecting leave:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

// 7. Cancel / Revoke a leave request
export const cancelLeave = async (req, res) => {
  const { id } = req.params;

  try {
    const [requests] = await db.query('SELECT * FROM leave_requests WHERE id = ?', [id]);
    if (requests.length === 0) {
      return res.status(404).json({ error: 'Leave request not found' });
    }

    const request = requests[0];

    if (request.status === 'CANCELLED') {
      return res.status(400).json({ error: 'Leave request is already cancelled' });
    }

    if (request.status === 'APPROVED') {
      const start = new Date(request.start_date);
      const end = new Date(request.end_date);
      const requestedDays = Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1;
      const year = start.getFullYear();

      await db.query(
        `UPDATE leave_balances 
         SET used_days = GREATEST(0, used_days - ?) 
         WHERE employee_id = ? AND leave_type = ? AND year = ?`,
        [requestedDays, request.employee_id, request.leave_type, year]
      );
    }

    await db.query(`UPDATE leave_requests SET status = 'CANCELLED' WHERE id = ?`, [id]);

    res.json({ message: 'Leave request cancelled and balance adjusted if applicable' });
  } catch (error) {
    console.error('Error cancelling leave:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

// 8. Allocate or update leave balance
export const setOrUpdateBalance = async (req, res) => {
  const { employee_id, leave_type, year, allocated_days } = req.body;

  if (!employee_id || !leave_type || !year || allocated_days === undefined) {
    return res.status(400).json({ error: 'employee_id, leave_type, year, and allocated_days are required' });
  }

  try {
    await db.query(
      `INSERT INTO leave_balances (employee_id, leave_type, year, allocated_days, used_days)
       VALUES (?, ?, ?, ?, 0)
       ON DUPLICATE KEY UPDATE allocated_days = ?`,
      [employee_id, leave_type, year, allocated_days, allocated_days]
    );

    res.status(200).json({
      message: 'Leave balance allocated/updated successfully',
      data: { employee_id, leave_type, year, allocated_days }
    });
  } catch (error) {
    console.error('Error setting leave balance:', error);
    res.status(500).json({ error: 'Server error' });
  }
};