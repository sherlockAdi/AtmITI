const express = require('express');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const { getPool, sql } = require('../database');
const { authenticateToken } = require('../middleware/auth');
const { uploadFile, getPublicFileUrl } = require('../utils/b2');
const { sendEmail } = require('../utils/email');
const config = require('../config');
const Razorpay = require('razorpay');
const crypto = require('crypto');

const router = express.Router();

// Configure multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({ 
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/jpg'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only PDF, JPEG, and PNG files are allowed.'));
    }
  }
});

const razorpay = new Razorpay({
  key_id: 'rzp_test_FTBeCZMTekegp2',
  key_secret: 'oYavJMAfXrp7temdtNK8RM1r'
});

// Get or create student profile
router.get('/profile', authenticateToken, async (req, res) => {
  try {
    const pool = getPool();
    
    let studentResult = await pool.request()
      .input('userId', sql.UniqueIdentifier, req.user.userId)
      .query(`
        SELECT s.*, u.firstName, u.lastName, u.email, u.phone
        FROM students s
        INNER JOIN users u ON s.userId = u.id
        WHERE s.userId = @userId
      `);
    
    if (studentResult.recordset.length === 0) {
      // Create new student record
      const applicationNumber = `APP${Date.now()}${Math.floor(Math.random() * 1000)}`;
      const studentId = uuidv4();
      
      await pool.request()
        .input('id', sql.UniqueIdentifier, studentId)
        .input('userId', sql.UniqueIdentifier, req.user.userId)
        .input('applicationNumber', sql.NVarChar, applicationNumber)
        .query(`
          INSERT INTO students (id, userId, applicationNumber)
          VALUES (@id, @userId, @applicationNumber)
        `);
      
      // Get the newly created student
      studentResult = await pool.request()
        .input('userId', sql.UniqueIdentifier, req.user.userId)
        .query(`
          SELECT s.*, u.firstName, u.lastName, u.email, u.phone
          FROM students s
          INNER JOIN users u ON s.userId = u.id
          WHERE s.userId = @userId
        `);
    }
    
    const student = studentResult.recordset[0];
    
    res.json({
      success: true,
      data: student
    });
    
  } catch (error) {
    console.error('Get student profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get student profile',
      error: error.message
    });
  }
});

// Update student profile
router.put('/profile', authenticateToken, async (req, res) => {
  try {
    const {
      personalInfo,
      addressInfo,
      academicInfo
    } = req.body;
    
    const pool = getPool();
    
    // Get student ID
    const studentResult = await pool.request()
      .input('userId', sql.UniqueIdentifier, req.user.userId)
      .query('SELECT id FROM students WHERE userId = @userId');
    
    if (studentResult.recordset.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Student profile not found'
      });
    }
    
    const studentId = studentResult.recordset[0].id;
    
    // Update student information
    await pool.request()
      .input('studentId', sql.UniqueIdentifier, studentId)
      .input('countryId', sql.UniqueIdentifier, addressInfo?.countryId)
      .input('stateId', sql.UniqueIdentifier, addressInfo?.stateId)
      .input('cityId', sql.UniqueIdentifier, addressInfo?.cityId)
      .input('collegeId', sql.UniqueIdentifier, academicInfo?.collegeId)
      .input('branchId', sql.UniqueIdentifier, academicInfo?.branchId)
      .input('tradeId', sql.UniqueIdentifier, academicInfo?.tradeId)
      .input('dateOfBirth', sql.Date, personalInfo?.dateOfBirth)
      .input('gender', sql.NVarChar, personalInfo?.gender)
      .input('category', sql.NVarChar, personalInfo?.category)
      .input('fatherName', sql.NVarChar, personalInfo?.fatherName)
      .input('motherName', sql.NVarChar, personalInfo?.motherName)
      .input('guardianName', sql.NVarChar, personalInfo?.guardianName)
      .input('address', sql.NVarChar, addressInfo?.address)
      .input('pincode', sql.NVarChar, addressInfo?.pincode)
      .query(`
        UPDATE students 
        SET 
          countryId = @countryId,
          stateId = @stateId,
          cityId = @cityId,
          collegeId = @collegeId,
          branchId = @branchId,
          tradeId = @tradeId,
          dateOfBirth = @dateOfBirth,
          gender = @gender,
          category = @category,
          fatherName = @fatherName,
          motherName = @motherName,
          guardianName = @guardianName,
          address = @address,
          pincode = @pincode,
          updatedAt = GETDATE()
        WHERE id = @studentId
      `);
    
    // Update user information
    if (personalInfo) {
      await pool.request()
        .input('userId', sql.UniqueIdentifier, req.user.userId)
        .input('firstName', sql.NVarChar, personalInfo.firstName)
        .input('lastName', sql.NVarChar, personalInfo.lastName)
        .input('email', sql.NVarChar, personalInfo.email)
        .input('phone', sql.NVarChar, personalInfo.phone)
        .query(`
          UPDATE users 
          SET 
            firstName = @firstName,
            lastName = @lastName,
            email = @email,
            phone = @phone,
            updatedAt = GETDATE()
          WHERE id = @userId
        `);
    }
    
    res.json({
      success: true,
      message: 'Profile updated successfully'
    });
    
  } catch (error) {
    console.error('Update student profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update profile',
      error: error.message
    });
  }
});

// Upload document
router.post('/documents/upload', authenticateToken, upload.single('file'), async (req, res) => {
  try {
    const { documentTypeId } = req.body;
    const file = req.file;
    
    if (!file) {
      return res.status(400).json({
        success: false,
        message: 'No file uploaded'
      });
    }
    
    const pool = getPool();
    
    // Get student ID
    const studentResult = await pool.request()
      .input('userId', sql.UniqueIdentifier, req.user.userId)
      .query('SELECT id, applicationNumber FROM students WHERE userId = @userId');
    
    if (studentResult.recordset.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Student profile not found'
      });
    }
    
    const student = studentResult.recordset[0];
    
    // Generate unique filename
    const fileExtension = file.originalname.split('.').pop();
    const fileName = `${student.applicationNumber}_${documentTypeId}_${Date.now()}.${fileExtension}`;
    
    // Upload file to B2
    const uploadResult = await uploadFile(file.buffer, fileName, file.mimetype);
    const filePath = await getPublicFileUrl(fileName);
    
    // Save document record
    const documentId = uuidv4();
    await pool.request()
      .input('id', sql.UniqueIdentifier, documentId)
      .input('studentId', sql.UniqueIdentifier, student.id)
      .input('documentTypeId', sql.UniqueIdentifier, documentTypeId)
      .input('fileName', sql.NVarChar, fileName)
      .input('originalName', sql.NVarChar, file.originalname)
      .input('filePath', sql.NVarChar, filePath)
      .input('fileSize', sql.BigInt, file.size)
      .input('mimeType', sql.NVarChar, file.mimetype)
      .query(`
        INSERT INTO documents (id, studentId, documentTypeId, fileName, originalName, filePath, fileSize, mimeType)
        VALUES (@id, @studentId, @documentTypeId, @fileName, @originalName, @filePath, @fileSize, @mimeType)
      `);
    
    // Get the uploaded document with type info
    const documentResult = await pool.request()
      .input('documentId', sql.UniqueIdentifier, documentId)
      .query(`
        SELECT d.*, dt.name as documentTypeName 
        FROM documents d
        INNER JOIN document_types dt ON d.documentTypeId = dt.id
        WHERE d.id = @documentId
      `);
    
    const document = documentResult.recordset[0];
    
    // Send notification email to admin
    await sendEmail(
      config.adminEmail,
      'New Document Uploaded - Smart Admission Portal',
      `
        <h2>New Document Uploaded</h2>
        <p>A student has uploaded a new document:</p>
        <ul>
          <li><strong>Student:</strong> ${student.applicationNumber}</li>
          <li><strong>Document Type:</strong> ${document.documentTypeName}</li>
          <li><strong>File Name:</strong> ${file.originalname}</li>
          <li><strong>Upload Time:</strong> ${new Date().toLocaleString()}</li>
        </ul>
        <p>Please review the document in the admin panel.</p>
      `
    );
    
    res.json({
      success: true,
      message: 'Document uploaded successfully',
      data: {
        id: document.id,
        documentTypeId: document.documentTypeId,
        fileName: document.fileName,
        originalName: document.originalName,
        filePath: document.filePath,
        fileSize: document.fileSize,
        mimeType: document.mimeType,
        uploadedAt: document.uploadedAt,
        status: document.status
      }
    });
    
  } catch (error) {
    console.error('Document upload error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to upload document',
      error: error.message
    });
  }
});

// Get student documents
router.get('/documents', authenticateToken, async (req, res) => {
  try {
    const pool = getPool();
    
    const documentsResult = await pool.request()
      .input('userId', sql.UniqueIdentifier, req.user.userId)
      .query(`
        SELECT d.*, dt.name as documentTypeName, dt.description as documentTypeDescription
        FROM documents d
        INNER JOIN document_types dt ON d.documentTypeId = dt.id
        INNER JOIN students s ON d.studentId = s.id
        WHERE s.userId = @userId
        ORDER BY d.uploadedAt DESC
      `);
    
    res.json({
      success: true,
      data: documentsResult.recordset
    });
    
  } catch (error) {
    console.error('Get student documents error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get documents',
      error: error.message
    });
  }
});

// Submit application
router.post('/submit', authenticateToken, async (req, res) => {
  try {
    const pool = getPool();
    
    // Get student information
    const studentResult = await pool.request()
      .input('userId', sql.UniqueIdentifier, req.user.userId)
      .query(`
        SELECT s.*, u.firstName, u.lastName, u.email
        FROM students s
        INNER JOIN users u ON s.userId = u.id
        WHERE s.userId = @userId
      `);
    
    if (studentResult.recordset.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Student profile not found'
      });
    }
    
    const student = studentResult.recordset[0];
    
    // Check if application is already submitted
    if (student.status !== 'draft') {
      return res.status(400).json({
        success: false,
        message: 'Application has already been submitted'
      });
    }
    
    // Update application status
    await pool.request()
      .input('studentId', sql.UniqueIdentifier, student.id)
      .query(`
        UPDATE students 
        SET status = 'submitted', submittedAt = GETDATE(), updatedAt = GETDATE()
        WHERE id = @studentId
      `);
    
    // Send confirmation email to student
    await sendEmail(
      student.email,
      'Application Submitted Successfully - Smart Admission Portal',
      `
        <h2>Application Submitted Successfully!</h2>
        <p>Hello ${student.firstName},</p>
        <p>Your admission application has been submitted successfully.</p>
        <p><strong>Application Number:</strong> ${student.applicationNumber}</p>
        <p><strong>Submitted On:</strong> ${new Date().toLocaleString()}</p>
        <p>Your application is now under review. You will receive an email notification once the review is complete.</p>
        <p>You can track your application status by logging into your account.</p>
        <p>Best regards,<br>Smart Admission Portal Team</p>
      `
    );
    
    // Send notification to admin
    await sendEmail(
      config.adminEmail,
      'New Application Submitted - Smart Admission Portal',
      `
        <h2>New Application Submitted</h2>
        <p>A student has submitted their admission application:</p>
        <ul>
          <li><strong>Student:</strong> ${student.firstName} ${student.lastName}</li>
          <li><strong>Application Number:</strong> ${student.applicationNumber}</li>
          <li><strong>Email:</strong> ${student.email}</li>
          <li><strong>Submitted On:</strong> ${new Date().toLocaleString()}</li>
        </ul>
        <p>Please review the application in the admin panel.</p>
      `
    );
    
    res.json({
      success: true,
      message: 'Application submitted successfully',
      data: {
        applicationNumber: student.applicationNumber,
        submittedAt: new Date()
      }
    });
    
  } catch (error) {
    console.error('Submit application error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to submit application',
      error: error.message
    });
  }
});

// Get payment plan and installment status for the student
router.get('/payment-plan', authenticateToken, async (req, res) => {
  try {
    const pool = getPool();
    // Get student ID and tradeId
    const studentResult = await pool.request()
      .input('userId', sql.UniqueIdentifier, req.user.userId)
      .query('SELECT id, tradeId FROM students WHERE userId = @userId');
    if (studentResult.recordset.length === 0) {
      return res.status(404).json({ success: false, message: 'Student profile not found' });
    }
    const studentId = studentResult.recordset[0].id;
    const tradeId = studentResult.recordset[0].tradeId;
    // Get total fee
    let totalAmount = 0;
    let installmentPlan = null;
    if (tradeId) {
      const feesResult = await pool.request()
        .input('tradeId', sql.UniqueIdentifier, tradeId)
        .query('SELECT amount FROM fees WHERE tradeId = @tradeId AND isActive = 1');
      totalAmount = feesResult.recordset.reduce((sum, fee) => sum + Number(fee.amount), 0);
    }
    // Get all payments
    const paymentsResult = await pool.request()
      .input('studentId', sql.UniqueIdentifier, studentId)
      .query('SELECT * FROM payments WHERE studentId = @studentId AND status = \'completed\' ORDER BY createdAt ASC');
    const payments = paymentsResult.recordset;
    const paidAmount = payments.reduce((sum, p) => sum + Number(p.amount), 0);
    const remainingAmount = totalAmount - paidAmount;
    // Check for active installment plan
    const lastInstallment = payments.filter(p => p.paymentMethod === 'installment').sort((a, b) => b.installmentNumber - a.installmentNumber)[0];
    if (lastInstallment && lastInstallment.totalInstallments) {
      const totalInstallments = lastInstallment.totalInstallments;
      const paidInstallments = payments.filter(p => p.paymentMethod === 'installment').length;
      const nextInstallmentNumber = paidInstallments + 1;
      const installmentAmount = lastInstallment.amount;
      const nextInstallmentAmount = Math.min(installmentAmount, remainingAmount);
      installmentPlan = {
        active: paidInstallments < totalInstallments,
        totalInstallments,
        paidInstallments,
        nextInstallmentNumber,
        installmentAmount: nextInstallmentAmount,
        remainingInstallments: totalInstallments - paidInstallments,
        canPayRemaining: true
      };
    }
    res.json({
      success: true,
      data: {
        totalAmount,
        paidAmount,
        remainingAmount,
        installmentPlan
      }
    });
  } catch (error) {
    console.error('Get payment plan error:', error);
    res.status(500).json({ success: false, message: 'Failed to get payment plan', error: error.message });
  }
});

// Initiate payment and create Razorpay order
router.post('/payments/initiate', authenticateToken, async (req, res) => {
  try {
    const { amount } = req.body;
    if (!amount) {
      return res.status(400).json({ success: false, message: 'Amount is required' });
    }
    const options = {
      amount: amount * 100, // in paise
      currency: 'INR',
      receipt: 'rcpt_' + Date.now(),
      payment_capture: 1
    };
    const order = await razorpay.orders.create(options);
    res.json({ success: true, orderId: order.id, amount: order.amount });
  } catch (error) {
    console.error('Razorpay order creation error:', error);
    res.status(500).json({ success: false, message: 'Failed to create order' });
  }
});

// Create payment record
router.post('/payments', authenticateToken, async (req, res) => {
  try {
    const { amount, paymentMethod, status, installmentNumber, totalInstallments } = req.body;
    const pool = getPool();
    
    const studentResult = await pool.request()
      .input('userId', sql.UniqueIdentifier, req.user.userId)
      .query('SELECT id FROM students WHERE userId = @userId');
    
    if (studentResult.recordset.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Student profile not found'
      });
    }
    
    const student = studentResult.recordset[0];
    const paymentId = uuidv4();
    
    await pool.request()
      .input('id', sql.UniqueIdentifier, paymentId)
      .input('studentId', sql.UniqueIdentifier, student.id)
      .input('amount', sql.Decimal(10, 2), amount)
      .input('paymentMethod', sql.NVarChar, paymentMethod)
      .input('status', sql.NVarChar, status)
      .input('transactionId', sql.NVarChar, `TXN${Date.now()}`)
      .input('installmentNumber', sql.Int, installmentNumber)
      .input('totalInstallments', sql.Int, totalInstallments)
      .input('paidAt', sql.DateTime2, status === 'completed' ? new Date() : null)
      .query(`
        INSERT INTO payments (id, studentId, amount, paymentMethod, status, transactionId, installmentNumber, totalInstallments, paidAt)
        VALUES (@id, @studentId, @amount, @paymentMethod, @status, @transactionId, @installmentNumber, @totalInstallments, @paidAt)
      `);

    // Update student status to 'submitted' after successful payment
    await pool.request()
      .input('studentId', sql.UniqueIdentifier, student.id)
      .query(`
        UPDATE students
        SET status = 'submitted', submittedAt = GETDATE(), updatedAt = GETDATE()
        WHERE id = @studentId
      `);

    // Send payment confirmation email to user
    const userResult = await pool.request()
      .input('userId', sql.UniqueIdentifier, req.user.userId)
      .query('SELECT email, firstName FROM users WHERE id = @userId');
    const user = userResult.recordset[0];
    if (user && user.email) {
      await sendEmail(
        user.email,
        'Payment Received - Smart Admission Portal',
        `
          <h2>Payment Received</h2>
          <p>Dear ${user.firstName || 'Student'},</p>
          <p>We have received your payment for your admission application.</p>
          <p>Your application is now complete and under review.</p>
          <p>Thank you for your payment!</p>
          <p>Best regards,<br>Smart Admission Portal Team</p>
        `
      );
    }
    
    res.json({
      success: true,
      message: 'Payment recorded successfully',
      data: { id: paymentId }
    });
    
  } catch (error) {
    console.error('Create payment error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to record payment',
      error: error.message
    });
  }
});

// Verify Razorpay payment signature
router.post('/payments/verify', authenticateToken, async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
    const key_secret = 'oYavJMAfXrp7temdtNK8RM1r'; // Razorpay test secret
    const generated_signature = crypto
      .createHmac('sha256', key_secret)
      .update(razorpay_order_id + '|' + razorpay_payment_id)
      .digest('hex');
    if (generated_signature === razorpay_signature) {
      // Payment is verified
      // You can update your DB to mark payment as successful here
      return res.json({ success: true, message: 'Payment verified successfully' });
    } else {
      return res.status(400).json({ success: false, message: 'Invalid payment signature' });
    }
  } catch (error) {
    console.error('Payment verification error:', error);
    res.status(500).json({ success: false, message: 'Failed to verify payment' });
  }
});

// Upsert student profile
router.post('/profile', authenticateToken, async (req, res) => {
  const {
    dateOfBirth, gender, category, fatherName, motherName, guardianName,
    address, countryId, stateId, cityId, pincode, collegeId, branchId, tradeId
  } = req.body;
  const userId = req.user.userId;
  const pool = getPool();

  // Check if student exists
  const result = await pool.request()
    .input('userId', sql.UniqueIdentifier, userId)
    .query('SELECT id FROM students WHERE userId = @userId');

  if (result.recordset.length === 0) {
    // Generate application number
    const applicationNumber = 'APP-' + Date.now();

    await pool.request()
      .input('id', sql.UniqueIdentifier, uuidv4())
      .input('userId', sql.UniqueIdentifier, userId)
      .input('applicationNumber', sql.NVarChar, applicationNumber)
      .input('dateOfBirth', sql.NVarChar, dateOfBirth)
      .input('gender', sql.NVarChar, gender)
      .input('category', sql.NVarChar, category)
      .input('fatherName', sql.NVarChar, fatherName)
      .input('motherName', sql.NVarChar, motherName)
      .input('guardianName', sql.NVarChar, guardianName)
      .input('address', sql.NVarChar, address)
      .input('countryId', sql.NVarChar, countryId)
      .input('stateId', sql.NVarChar, stateId)
      .input('cityId', sql.NVarChar, cityId)
      .input('pincode', sql.NVarChar, pincode)
      .input('collegeId', sql.NVarChar, collegeId)
      .input('branchId', sql.NVarChar, branchId)
      .input('tradeId', sql.NVarChar, tradeId)
      .query(`INSERT INTO students (id, userId, applicationNumber, dateOfBirth, gender, category, fatherName, motherName, guardianName, address, countryId, stateId, cityId, pincode, collegeId, branchId, tradeId)
              VALUES (@id, @userId, @applicationNumber, @dateOfBirth, @gender, @category, @fatherName, @motherName, @guardianName, @address, @countryId, @stateId, @cityId, @pincode, @collegeId, @branchId, @tradeId)`);
  } else {
    // Update existing student
    await pool.request()
      .input('userId', sql.UniqueIdentifier, userId)
      .input('dateOfBirth', sql.NVarChar, dateOfBirth)
      .input('gender', sql.NVarChar, gender)
      .input('category', sql.NVarChar, category)
      .input('fatherName', sql.NVarChar, fatherName)
      .input('motherName', sql.NVarChar, motherName)
      .input('guardianName', sql.NVarChar, guardianName)
      .input('address', sql.NVarChar, address)
      .input('countryId', sql.NVarChar, countryId)
      .input('stateId', sql.NVarChar, stateId)
      .input('cityId', sql.NVarChar, cityId)
      .input('pincode', sql.NVarChar, pincode)
      .input('collegeId', sql.NVarChar, collegeId)
      .input('branchId', sql.NVarChar, branchId)
      .input('tradeId', sql.NVarChar, tradeId)
      .query(`UPDATE students SET dateOfBirth=@dateOfBirth, gender=@gender, category=@category, fatherName=@fatherName, motherName=@motherName, guardianName=@guardianName, address=@address, countryId=@countryId, stateId=@stateId, cityId=@cityId, pincode=@pincode, collegeId=@collegeId, branchId=@branchId, tradeId=@tradeId WHERE userId=@userId`);
  }

  res.json({ success: true });
});

// GET /summary - Student summary profile (basic details + payment info)
router.get('/summary', authenticateToken, async (req, res) => {
  try {
    const pool = getPool();
    // Get student profile with user info and master data names
    const studentResult = await pool.request()
      .input('userId', sql.UniqueIdentifier, req.user.userId)
      .query(`
        SELECT s.applicationNumber, s.dateOfBirth, s.gender, s.category, s.fatherName, s.motherName, s.guardianName,
               s.address, s.pincode, s.status, s.submittedAt,
               u.firstName, u.lastName, u.email, u.phone,
               c.name AS college, b.name AS branch, t.name AS trade
        FROM students s
        INNER JOIN users u ON s.userId = u.id
        LEFT JOIN colleges c ON s.collegeId = c.id
        LEFT JOIN branches b ON s.branchId = b.id
        LEFT JOIN trades t ON s.tradeId = t.id
        WHERE s.userId = @userId
      `);
    if (studentResult.recordset.length === 0) {
      return res.status(404).json({ success: false, message: 'Student profile not found' });
    }
    const student = studentResult.recordset[0];

    // Get payment info (total, paid, remaining)
    // 1. Get tradeId for fee lookup
    const tradeResult = await pool.request()
      .input('userId', sql.UniqueIdentifier, req.user.userId)
      .query('SELECT tradeId, id FROM students WHERE userId = @userId');
    const tradeId = tradeResult.recordset[0]?.tradeId;
    const studentId = tradeResult.recordset[0]?.id;
    let totalAmount = 0;
    if (tradeId) {
      const feesResult = await pool.request()
        .input('tradeId', sql.UniqueIdentifier, tradeId)
        .query('SELECT amount FROM fees WHERE tradeId = @tradeId AND isActive = 1');
      totalAmount = feesResult.recordset.reduce((sum, fee) => sum + Number(fee.amount), 0);
    }
    let paidAmount = 0;
    if (studentId) {
      const paymentsResult = await pool.request()
        .input('studentId', sql.UniqueIdentifier, studentId)
        .query("SELECT ISNULL(SUM(amount), 0) as paidAmount FROM payments WHERE studentId = @studentId AND status = 'completed'");
      paidAmount = paymentsResult.recordset[0]?.paidAmount || 0;
    }
    const remainingAmount = totalAmount - paidAmount;

    // Compose summary response
    res.json({
      success: true,
      data: {
        student: {
          applicationNumber: student.applicationNumber,
          name: `${student.firstName} ${student.lastName}`,
          email: student.email,
          phone: student.phone,
          dateOfBirth: student.dateOfBirth,
          gender: student.gender,
          category: student.category,
          fatherName: student.fatherName,
          motherName: student.motherName,
          guardianName: student.guardianName,
          address: student.address,
          pincode: student.pincode,
          college: student.college,
          branch: student.branch,
          trade: student.trade,
          status: student.status,
          submittedAt: student.submittedAt
        },
        payment: {
          totalAmount,
          paidAmount,
          remainingAmount
        }
      }
    });
  } catch (error) {
    console.error('Get student summary error:', error);
    res.status(500).json({ success: false, message: 'Failed to get student summary', error: error.message });
  }
});

// Get all payments for the logged-in student
router.get('/payments', authenticateToken, async (req, res) => {
  try {
    const pool = getPool();
    // Get student ID
    const studentResult = await pool.request()
      .input('userId', sql.UniqueIdentifier, req.user.userId)
      .query('SELECT id FROM students WHERE userId = @userId');
    if (studentResult.recordset.length === 0) {
      return res.json({ success: true, data: [] }); // No student, return empty array
    }
    const studentId = studentResult.recordset[0].id;
    // Get all payments for this student
    const paymentsResult = await pool.request()
      .input('studentId', sql.UniqueIdentifier, studentId)
      .query('SELECT * FROM payments WHERE studentId = @studentId ORDER BY createdAt ASC');
    res.json({ success: true, data: paymentsResult.recordset });
  } catch (error) {
    console.error('Get student payments error:', error);
    res.status(500).json({ success: false, message: 'Failed to get payments', error: error.message });
  }
});

// Replace student document
router.post('/documents/:id/replace', authenticateToken, upload.single('file'), async (req, res) => {
  try {
    const { id } = req.params;
    const file = req.file;
    if (!file) {
      return res.status(400).json({ success: false, message: 'No file uploaded' });
    }

    const pool = getPool();
    // Get the document and student
    const docResult = await pool.request()
      .input('id', sql.UniqueIdentifier, id)
      .query('SELECT * FROM documents WHERE id = @id');
    if (docResult.recordset.length === 0) {
      return res.status(404).json({ success: false, message: 'Document not found' });
    }
    const document = docResult.recordset[0];

    // Check that the document belongs to the current user
    const studentResult = await pool.request()
      .input('userId', sql.UniqueIdentifier, req.user.userId)
      .query('SELECT id FROM students WHERE userId = @userId');
    if (studentResult.recordset.length === 0 || document.studentId !== studentResult.recordset[0].id) {
      return res.status(403).json({ success: false, message: 'Unauthorized' });
    }

    // Generate new fileName
    const fileExtension = file.originalname.split('.').pop();
    const newFileName = `${document.fileName.split('.')[0]}_replaced_${Date.now()}.${fileExtension}`;

    // Upload new file to B2
    const uploadResult = await uploadFile(file.buffer, newFileName, file.mimetype);
    const filePath = await getPublicFileUrl(newFileName);

    // Update document record
    await pool.request()
      .input('id', sql.UniqueIdentifier, id)
      .input('fileName', sql.NVarChar, newFileName)
      .input('originalName', sql.NVarChar, file.originalname)
      .input('filePath', sql.NVarChar, filePath)
      .input('fileSize', sql.BigInt, file.size)
      .input('mimeType', sql.NVarChar, file.mimetype)
      .query(`
        UPDATE documents
        SET fileName = @fileName, originalName = @originalName, filePath = @filePath, fileSize = @fileSize, mimeType = @mimeType, status = 'pending', rejectionReason = NULL, updatedAt = GETDATE()
        WHERE id = @id
      `);

    res.json({ success: true, message: 'Document replaced successfully' });
  } catch (error) {
    console.error('Replace document error:', error);
    res.status(500).json({ success: false, message: 'Failed to replace document', error: error.message });
  }
});

module.exports = router;