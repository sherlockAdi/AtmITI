const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { getPool, sql } = require('../database');
const config = require('../config');
const { sendEmail } = require('../utils/email');
const { authenticateToken } = require('../middleware/auth');
const { 
  registerValidation, 
  loginValidation, 
  validateRequest 
} = require('../middleware/validation');

const router = express.Router();

// Register
router.post('/register', registerValidation, validateRequest, async (req, res) => {
  try {
    const { firstName, lastName, email, phone, password } = req.body;
    const pool = getPool();
    
    // Check if user already exists
    const existingUser = await pool.request()
      .input('email', sql.NVarChar, email)
      .input('phone', sql.NVarChar, phone)
      .query('SELECT id FROM users WHERE email = @email OR phone = @phone');
    
    if (existingUser.recordset.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'User with this email or phone already exists'
      });
    }
    
    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);
    
    // Create user
    const userId = uuidv4();
    await pool.request()
      .input('id', sql.UniqueIdentifier, userId)
      .input('firstName', sql.NVarChar, firstName)
      .input('lastName', sql.NVarChar, lastName)
      .input('email', sql.NVarChar, email)
      .input('phone', sql.NVarChar, phone)
      .input('password', sql.NVarChar, hashedPassword)
      .query(`
        INSERT INTO users (id, firstName, lastName, email, phone, password)
        VALUES (@id, @firstName, @lastName, @email, @phone, @password)
      `);
    
    // Generate verification code
    const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
    
    await pool.request()
      .input('email', sql.NVarChar, email)
      .input('code', sql.NVarChar, verificationCode)
      .input('type', sql.NVarChar, 'email')
      .input('expiresAt', sql.DateTime2, expiresAt)
      .query(`
        INSERT INTO verification_codes (email, code, type, expiresAt)
        VALUES (@email, @code, @type, @expiresAt)
      `);
    
    // Send verification email
    await sendEmail(
      email,
      'Verify Your Email - Smart Admission Portal',
      `
        <h2>Welcome to Smart Admission Portal!</h2>
        <p>Hello ${firstName},</p>
        <p>Thank you for registering with us. Please use the following verification code to verify your email:</p>
        <h3 style="background: #f0f0f0; padding: 10px; text-align: center; font-size: 24px; letter-spacing: 2px;">${verificationCode}</h3>
        <p>This code will expire in 10 minutes.</p>
        <p>If you didn't create this account, please ignore this email.</p>
        <p>Best regards,<br>Smart Admission Portal Team</p>
      `
    );
    
    // Send notification to admin
    await sendEmail(
      config.adminEmail,
      'New User Registration - Smart Admission Portal',
      `
        <h2>New User Registration</h2>
        <p>A new user has registered on the Smart Admission Portal:</p>
        <ul>
          <li><strong>Name:</strong> ${firstName} ${lastName}</li>
          <li><strong>Email:</strong> ${email}</li>
          <li><strong>Phone:</strong> ${phone}</li>
          <li><strong>Registration Time:</strong> ${new Date().toLocaleString()}</li>
        </ul>
        <p>Please monitor the application process.</p>
      `
    );
    
    res.status(201).json({
      success: true,
      message: 'Registration successful! Please check your email for verification code.',
      data: { email }
    });
    
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({
      success: false,
      message: 'Registration failed',
      error: error.message
    });
  }
});

// Verify email
router.post('/verify-email', async (req, res) => {
  try {
    const { email, code } = req.body;
    const pool = getPool();
    
    // Check verification code
    const codeResult = await pool.request()
      .input('email', sql.NVarChar, email)
      .input('code', sql.NVarChar, code)
      .input('type', sql.NVarChar, 'email')
      .query(`
        SELECT * FROM verification_codes 
        WHERE email = @email AND code = @code AND type = @type AND isUsed = 0
      `);
    console.log('rtr',codeResult, email,code)
    if (codeResult.recordset.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired verification code'
      });
    }
    console.log('rtr2')
    // Mark code as used
    await pool.request()
      .input('email', sql.NVarChar, email)
      .input('code', sql.NVarChar, code)
      .query(`
        UPDATE verification_codes 
        SET isUsed = 1 
        WHERE email = @email AND code = @code
      `);
      console.log('rtr3')
    // Update user email verification status
    await pool.request()
      .input('email', sql.NVarChar, email)
      .query(`
        UPDATE users 
        SET isEmailVerified = 1, updatedAt = GETDATE() 
        WHERE email = @email
      `);
      console.log('rtr4')
    // Get user details
    const userResult = await pool.request()
      .input('email', sql.NVarChar, email)
      .query(`
        SELECT id, firstName, lastName, email, phone, role, isEmailVerified, isPhoneVerified 
        FROM users 
        WHERE email = @email
      `);
    
    const user = userResult.recordset[0];
    console.log('rtr5')
    // Generate JWT token
    const token = jwt.sign(
      { userId: user.id, email: user.email, role: user.role },
      config.jwtSecret,
      { expiresIn: '24h' }
    );
    
    res.json({
      success: true,
      message: 'Email verified successfully',
      data: {
        user: {
          id: user.id,
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email,
          phone: user.phone,
          role: user.role,
          isEmailVerified: user.isEmailVerified,
          isPhoneVerified: user.isPhoneVerified
        },
        tokens: {
          accessToken: token,
          refreshToken: token
        }
      }
    });
    
  } catch (error) {
    console.error('Email verification error:', error);
    res.status(500).json({
      success: false,
      message: 'Email verification failed',
      error: error.message
    });
  }
});

// Login
router.post('/login', loginValidation, validateRequest, async (req, res) => {
  try {
    const { email, password } = req.body;
    const pool = getPool();
    
    // Find user(s) by email
    const userResult = await pool.request()
      .input('email', sql.NVarChar, email)
      .query(`
        SELECT id, firstName, lastName, email, phone, password, role, isEmailVerified, isPhoneVerified 
        FROM users 
        WHERE email = @email
      `);
    
    if (userResult.recordset.length === 0) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
    }
    // If multiple users with same email
    if (userResult.recordset.length > 1) {
      return res.status(400).json({
        success: false,
        message: 'Multiple users with same email. Login with email not permitted, please login with phone number.'
      });
    }
    
    const user = userResult.recordset[0];
    
    // Check password
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
    }
    
    // Check if email is verified
    if (!user.isEmailVerified) {
      return res.status(400).json({
        success: false,
        message: 'Please verify your email before logging in'
      });
    }
    
    // Generate JWT token
    const token = jwt.sign(
      { userId: user.id, email: user.email, role: user.role },
      config.jwtSecret,
      { expiresIn: '24h' }
    );
    
    res.json({
      success: true,
      message: 'Login successful',
      data: {
        user: {
          id: user.id,
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email,
          phone: user.phone,
          role: user.role,
          isEmailVerified: user.isEmailVerified,
          isPhoneVerified: user.isPhoneVerified
        },
        tokens: {
          accessToken: token,
          refreshToken: token
        }
      }
    });
    
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: 'Login failed',
      error: error.message
    });
  }
});

// Bulk Register
router.post('/bulk-register', async (req, res) => {
  try {
    const users = req.body.users;
    if (!Array.isArray(users) || users.length === 0) {
      return res.status(400).json({ success: false, message: 'Users array is required' });
    }
    const pool = getPool();
    const results = [];
    const registeredUsers = [];
    for (const user of users) {
      const { firstName, lastName, email, phone } = user;
      if (!firstName || !lastName || !email || !phone) {
        results.push({ email, phone, success: false, message: 'Missing required fields' });
        continue;
      }
      // REMOVE: Check if user already exists
      // Always insert the user
      // Hash password (atm@123)
      const hashedPassword = await bcrypt.hash('atm@123', 10);
      // Create user
      const userId = uuidv4();
      await pool.request()
        .input('id', sql.UniqueIdentifier, userId)
        .input('firstName', sql.NVarChar, firstName)
        .input('lastName', sql.NVarChar, lastName)
        .input('email', sql.NVarChar, email)
        .input('phone', sql.NVarChar, phone)
        .input('password', sql.NVarChar, hashedPassword)
        .query(`
          INSERT INTO users (id, firstName, lastName, email, phone, password)
          VALUES (@id, @firstName, @lastName, @email, @phone, @password)
        `);
      results.push({ email, phone, success: true });
      registeredUsers.push({ firstName, lastName, email, phone, password: 'atm@123' });
      // Send verification email to akdwivedi7355@gmail.com
      const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
      await pool.request()
        .input('email', sql.NVarChar, email)
        .input('code', sql.NVarChar, verificationCode)
        .input('type', sql.NVarChar, 'email')
        .input('expiresAt', sql.DateTime2, expiresAt)
        .query(`
          INSERT INTO verification_codes (email, code, type, expiresAt)
          VALUES (@email, @code, @type, @expiresAt)
        `);
      await sendEmail(
        'akdwivedi7355@gmail.com',
        'Verify Your Email - Smart Admission Portal',
        `
          <h2>Welcome to Smart Admission Portal!</h2>
          <p>Hello ${firstName},</p>
          <p>Thank you for registering with us. Please use the following verification code to verify your email:</p>
          <h3 style="background: #f0f0f0; padding: 10px; text-align: center; font-size: 24px; letter-spacing: 2px;">${verificationCode}</h3>
          <p>This code will expire in 10 minutes.</p>
          <p>If you didn't create this account, please ignore this email.</p>
          <p>Best regards,<br>Smart Admission Portal Team</p>
        `
      );
      // Send notification to admin (also to akdwivedi7355@gmail.com)
      await sendEmail(
        'akdwivedi7355@gmail.com',
        'New User Registration - Smart Admission Portal',
        `
          <h2>New User Registration</h2>
          <p>A new user has registered on the Smart Admission Portal:</p>
          <ul>
            <li><strong>Name:</strong> ${firstName} ${lastName}</li>
            <li><strong>Email:</strong> ${email}</li>
            <li><strong>Phone:</strong> ${phone}</li>
            <li><strong>Registration Time:</strong> ${new Date().toLocaleString()}</li>
          </ul>
          <p>Please monitor the application process.</p>
        `
      );
    }
    // Send summary email to akdwivedi7355@gmail.com
    if (registeredUsers.length > 0) {
      let summaryHtml = '<h2>Bulk Registration Summary</h2><table border="1" cellpadding="5" cellspacing="0"><tr><th>Name</th><th>Email</th><th>Phone</th><th>Password</th></tr>';
      for (const u of registeredUsers) {
        summaryHtml += `<tr><td>${u.firstName} ${u.lastName}</td><td>${u.email}</td><td>${u.phone}</td><td>${u.password}</td></tr>`;
      }
      summaryHtml += '</table>';
      await sendEmail(
        'akdwivedi7355@gmail.com',
        'Bulk Registration Details - Smart Admission Portal',
        summaryHtml
      );
    }
    res.json({ success: true, results });
  } catch (error) {
    console.error('Bulk registration error:', error);
    res.status(500).json({ success: false, message: 'Bulk registration failed', error: error.message });
  }
});

// Login with mobile
router.post('/login-mobile', async (req, res) => {
  try {
    const { phone, password } = req.body;
    if (!phone || !password) {
      return res.status(400).json({ success: false, message: 'Phone and password are required' });
    }
    const pool = getPool();
    // Find user by phone
    const userResult = await pool.request()
      .input('phone', sql.NVarChar, phone)
      .query(`
        SELECT id, firstName, lastName, email, phone, password, role, isEmailVerified, isPhoneVerified 
        FROM users 
        WHERE phone = @phone
      `);
    if (userResult.recordset.length === 0) {
      return res.status(401).json({ success: false, message: 'Invalid phone or password' });
    }
    const user = userResult.recordset[0];
    // Check password
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({ success: false, message: 'Invalid phone or password' });
    }
    // Check if phone is verified (optional, can be removed if not needed)
    // if (!user.isPhoneVerified) {
    //   return res.status(400).json({ success: false, message: 'Please verify your phone before logging in' });
    // }
    // Generate JWT token
    const token = jwt.sign(
      { userId: user.id, email: user.email, role: user.role },
      config.jwtSecret,
      { expiresIn: '24h' }
    );
    res.json({
      success: true,
      message: 'Login successful',
      data: {
        user: {
          id: user.id,
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email,
          phone: user.phone,
          role: user.role,
          isEmailVerified: user.isEmailVerified,
          isPhoneVerified: user.isPhoneVerified
        },
        tokens: {
          accessToken: token,
          refreshToken: token
        }
      }
    });
  } catch (error) {
    console.error('Login with mobile error:', error);
    res.status(500).json({ success: false, message: 'Login failed', error: error.message });
  }
});

// Get current user
router.get('/me', authenticateToken, async (req, res) => {
  try {
    const pool = getPool();
    
    const userResult = await pool.request()
      .input('userId', sql.UniqueIdentifier, req.user.userId)
      .query(`
        SELECT id, firstName, lastName, email, phone, role, isEmailVerified, isPhoneVerified, createdAt 
        FROM users 
        WHERE id = @userId
      `);
    
    if (userResult.recordset.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    
    const user = userResult.recordset[0];
    
    res.json({
      success: true,
      data: {
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        phone: user.phone,
        role: user.role,
        isEmailVerified: user.isEmailVerified,
        isPhoneVerified: user.isPhoneVerified,
        createdAt: user.createdAt
      }
    });
    
  } catch (error) {
    console.error('Get current user error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get user information',
      error: error.message
    });
  }
});

// Logout
router.post('/logout', authenticateToken, async (req, res) => {
  try {
    // In a real application, you might want to blacklist the token
    // For now, we'll just send a success response
    res.json({
      success: true,
      message: 'Logged out successfully'
    });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({
      success: false,
      message: 'Logout failed',
      error: error.message
    });
  }
});

// Change password by email
router.post('/change-password', async (req, res) => {
  try {
    const { email, currentPassword, newPassword } = req.body;
    
    // Validate input
    if (!email || !currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        message: 'Email, current password, and new password are required'
      });
    }
    
    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'New password must be at least 6 characters long'
      });
    }
    
    const pool = getPool();
    
    // Get user by email
    const userResult = await pool.request()
      .input('email', sql.NVarChar, email)
      .query(`
        SELECT id, password, firstName, lastName, email 
        FROM users 
        WHERE email = @email
      `);
    
    if (userResult.recordset.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    
    const user = userResult.recordset[0];
    
    // Verify current password
    const isCurrentPasswordValid = await bcrypt.compare(currentPassword, user.password);
    if (!isCurrentPasswordValid) {
      return res.status(400).json({
        success: false,
        message: 'Current password is incorrect'
      });
    }
    
    // Hash new password
    const hashedNewPassword = await bcrypt.hash(newPassword, 10);
    
    // Update password
    await pool.request()
      .input('userId', sql.UniqueIdentifier, user.id)
      .input('password', sql.NVarChar, hashedNewPassword)
      .input('updatedAt', sql.DateTime, new Date())
      .query(`
        UPDATE users 
        SET password = @password, updatedAt = @updatedAt 
        WHERE id = @userId
      `);
    
    // Send email notification
    await sendEmail(
      user.email,
      'Password Changed - Smart Admission Portal',
      `
        <h2>Password Changed Successfully</h2>
        <p>Hello ${user.firstName},</p>
        <p>Your password has been changed successfully.</p>
        <p>If you didn't make this change, please contact support immediately.</p>
        <p>Best regards,<br>Smart Admission Portal Team</p>
      `
    );
    
    res.json({
      success: true,
      message: 'Password changed successfully'
    });
    
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to change password',
      error: error.message
    });
  }
});

module.exports = router;