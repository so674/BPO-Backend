import express from 'express';
import {
  login,
  logout,
  me, // Fixed: matching authController.js export
  refreshToken,
  changePassword
} from '../controllers/authController.js';

const router = express.Router();

router.post('/login', login);
router.post('/logout', logout);
router.get('/me', me); // Fixed: using 'me' instead of 'getMe'
router.post('/refresh', refreshToken);
router.post('/change-password', changePassword);

export default router;