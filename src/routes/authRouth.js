import express from 'express';
import {
  login,
  logout,
  getMe,
  refreshToken,
  changePassword
} from '../controllers/authController.js';

const router = express.Router();

router.post('/login', login);
router.post('/logout', logout);
router.get('/me', getMe);
router.post('/refresh', refreshToken);
router.post('/change-password', changePassword);

export default router;