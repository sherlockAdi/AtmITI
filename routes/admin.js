const express = require('express');
const { getPool, sql } = require('../database');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { sendEmail } = require('../utils/email');
const config = require('../config');
const { v4: uuidv4 } = require('uuid');

const router = express.Router();

// Apply admin role requirement to all routes
router.use(authenticateToken);
router.use(requireRole('admin'));

// Get dashboard stats
router.get('/dashboard/stats', async (req, res) => {
  try {
    const pool = getPool();
    
    const statsResult = await pool.request()
      .query(`
        SELECT 
          (SELECT COUNT(*) FROM students WHERE status != 'draft') as totalApplications,
          (SELECT COUNT(*) FROM students WHERE status = 'submitted') as pendingReviews,
          (SELECT ISNULL(SUM(amount), 0) FROM payments WHERE status = 'completed') as completedPayments,
          (SELECT COUNT(*) FROM students WHERE status = 'approved') as approvedApplications
      `);
    
    const stats = statsResult.recordset[0];
    
    res.json({
      success: true,
      data: {
        totalApplications: stats.totalApplications || 0,
        pendingReviews: stats.pendingReviews || 0,
        completedPayments: stats.completedPayments || 0,
        approvedApplications: stats.approvedApplications || 0
      }
    });
    
  } catch (error) {
    console.error('Get dashboard stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get dashboard stats',
      error: error.message
    });
  }
});

// Get monthly data for charts
router.get('/dashboard/monthly-data', async (req, res) => {
  try {
    const pool = getPool();
    
    const monthlyResult = await pool.request()
      .query(`
        SELECT 
          FORMAT(submittedAt, 'MMM') as month,
          COUNT(*) as applications,
          SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) as approved
        FROM students 
        WHERE submittedAt >= DATEADD(month, -6, GETDATE())
        GROUP BY FORMAT(submittedAt, 'MMM'), MONTH(submittedAt)
        ORDER BY MONTH(submittedAt)
      `);
    
    res.json({
      success: true,
      data: monthlyResult.recordset
    });
    
  } catch (error) {
    console.error('Get monthly data error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get monthly data',
      error: error.message
    });
  }
});

// Get status distribution for pie chart
router.get('/dashboard/status-distribution', async (req, res) => {
  try {
    const pool = getPool();
    
    const statusResult = await pool.request()
      .query(`
        SELECT 
          status as name,
          COUNT(*) as value
        FROM students 
        WHERE status != 'draft'
        GROUP BY status
      `);
    
    res.json({
      success: true,
      data: statusResult.recordset
    });
    
  } catch (error) {
    console.error('Get status distribution error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get status distribution',
      error: error.message
    });
  }
});

// Get recent applications for dashboard
router.get('/dashboard/recent-applications', async (req, res) => {
  try {
    const pool = getPool();
    
    const applicationsResult = await pool.request()
      .query(`
        SELECT TOP 10 
          s.id,
          s.applicationNumber,
          CONCAT(u.firstName, ' ', u.lastName) as studentName,
          c.name as college,
          b.name as branch,
          t.name as trade,
          s.status,
          s.submittedAt
        FROM students s
        INNER JOIN users u ON s.userId = u.id
        LEFT JOIN colleges c ON s.collegeId = c.id
        LEFT JOIN branches b ON s.branchId = b.id
        LEFT JOIN trades t ON s.tradeId = t.id
        WHERE s.status != 'draft'
        ORDER BY s.submittedAt DESC
      `);
    
    res.json({
      success: true,
      data: applicationsResult.recordset
    });
    
  } catch (error) {
    console.error('Get recent applications error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get recent applications',
      error: error.message
    });
  }
});

// Get all applications
router.get('/applications', async (req, res) => {
  try {
    const { page = 1, limit = 10, status, search } = req.query;
    const offset = (page - 1) * limit;
    
    const pool = getPool();
    
    let whereClause = "WHERE s.status != 'draft'";
    if (status) {
      whereClause += ` AND s.status = '${status}'`;
    }
    if (search) {
      whereClause += ` AND (s.applicationNumber LIKE '%${search}%' OR u.firstName LIKE '%${search}%' OR u.lastName LIKE '%${search}%')`;
    }
    
    const applicationsResult = await pool.request()
      .query(`
        SELECT 
          s.id,
          s.applicationNumber,
          CONCAT(u.firstName, ' ', u.lastName) as studentName,
          u.email,
          u.phone,
          c.name as college,
          b.name as branch,
          t.name as trade,
          s.status,
          s.submittedAt,
          s.approvedAt,
          s.rejectedAt
        FROM students s
        INNER JOIN users u ON s.userId = u.id
        LEFT JOIN colleges c ON s.collegeId = c.id
        LEFT JOIN branches b ON s.branchId = b.id
        LEFT JOIN trades t ON s.tradeId = t.id
        ${whereClause}
        ORDER BY s.submittedAt DESC
        OFFSET ${offset} ROWS
        FETCH NEXT ${limit} ROWS ONLY
      `);
    
    const countResult = await pool.request()
      .query(`
        SELECT COUNT(*) as total
        FROM students s
        INNER JOIN users u ON s.userId = u.id
        ${whereClause}
      `);
    
    const total = countResult.recordset[0].total;
    
    res.json({
      success: true,
      data: applicationsResult.recordset,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: total,
        totalPages: Math.ceil(total / limit)
      }
    });
    
  } catch (error) {
    console.error('Get applications error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get applications',
      error: error.message
    });
  }
});

// Get application details
router.get('/applications/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const pool = getPool();
    
    const applicationResult = await pool.request()
      .input('studentId', sql.UniqueIdentifier, id)
      .query(`
        SELECT 
          s.*,
          u.firstName, u.lastName, u.email, u.phone,
          c.name as collegeName,
          b.name as branchName,
          t.name as tradeName,
          country.name as countryName,
          state.name as stateName,
          city.name as cityName
        FROM students s
        INNER JOIN users u ON s.userId = u.id
        LEFT JOIN colleges c ON s.collegeId = c.id
        LEFT JOIN branches b ON s.branchId = b.id
        LEFT JOIN trades t ON s.tradeId = t.id
        LEFT JOIN countries country ON s.countryId = country.id
        LEFT JOIN states state ON s.stateId = state.id
        LEFT JOIN cities city ON s.cityId = city.id
        WHERE s.id = @studentId
      `);
    
    if (applicationResult.recordset.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Application not found'
      });
    }
    
    const application = applicationResult.recordset[0];
    
    // Get documents
    const documentsResult = await pool.request()
      .input('studentId', sql.UniqueIdentifier, id)
      .query(`
        SELECT d.*, dt.name as documentTypeName
        FROM documents d
        INNER JOIN document_types dt ON d.documentTypeId = dt.id
        WHERE d.studentId = @studentId
      `);
    
    // Get payments
    const paymentsResult = await pool.request()
      .input('studentId', sql.UniqueIdentifier, id)
      .query(`
        SELECT * FROM payments
        WHERE studentId = @studentId
      `);
    
    res.json({
      success: true,
      data: {
        application,
        documents: documentsResult.recordset,
        payments: paymentsResult.recordset
      }
    });
    
  } catch (error) {
    console.error('Get application details error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get application details',
      error: error.message
    });
  }
});

// Approve application
router.post('/applications/:id/approve', async (req, res) => {
  try {
    const { id } = req.params;
    const pool = getPool();
    
    // Get application details
    const applicationResult = await pool.request()
      .input('studentId', sql.UniqueIdentifier, id)
      .query(`
        SELECT s.*, u.firstName, u.lastName, u.email
        FROM students s
        INNER JOIN users u ON s.userId = u.id
        WHERE s.id = @studentId
      `);
    
    if (applicationResult.recordset.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Application not found'
      });
    }
    
    const application = applicationResult.recordset[0];
    
    // Update application status
    await pool.request()
      .input('studentId', sql.UniqueIdentifier, id)
      .query(`
        UPDATE students
        SET status = 'approved', approvedAt = GETDATE(), updatedAt = GETDATE()
        WHERE id = @studentId
      `);
    
    // Send approval email
    await sendEmail(
      application.email,
      'Application Approved - Smart Admission Portal',
      `
        <h2>Congratulations! Your Application has been Approved</h2>
        <p>Hello ${application.firstName},</p>
        <p>We are pleased to inform you that your admission application has been approved!</p>
        <p><strong>Application Number:</strong> ${application.applicationNumber}</p>
        <p><strong>Approved On:</strong> ${new Date().toLocaleString()}</p>
        <p>You will receive further instructions about the next steps via email.</p>
        <p>Welcome to our institution!</p>
        <p>Best regards,<br>Smart Admission Portal Team</p>
      `
    );

    // Send notification to admin
    await sendEmail(
      config.adminEmail,
      'Application Approved - Smart Admission Portal',
      `
        <h2>Application Approved</h2>
        <p>An application has been approved:</p>
        <ul>
          <li><strong>Student:</strong> ${application.firstName} ${application.lastName}</li>
          <li><strong>Application Number:</strong> ${application.applicationNumber}</li>
          <li><strong>Approved By:</strong> Admin</li>
          <li><strong>Approved On:</strong> ${new Date().toLocaleString()}</li>
        </ul>
      `
    );
    
    res.json({
      success: true,
      message: 'Application approved successfully'
    });
    
  } catch (error) {
    console.error('Approve application error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to approve application',
      error: error.message
    });
  }
});

// Reject application
router.post('/applications/:id/reject', async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    const pool = getPool();
    
    // Get application details
    const applicationResult = await pool.request()
      .input('studentId', sql.UniqueIdentifier, id)
      .query(`
        SELECT s.*, u.firstName, u.lastName, u.email
        FROM students s
        INNER JOIN users u ON s.userId = u.id
        WHERE s.id = @studentId
      `);
    
    if (applicationResult.recordset.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Application not found'
      });
    }
    
    const application = applicationResult.recordset[0];
    
    // Update application status
    await pool.request()
      .input('studentId', sql.UniqueIdentifier, id)
      .input('reason', sql.NVarChar, reason)
      .query(`
        UPDATE students
        SET status = 'rejected', rejectedAt = GETDATE(), rejectionReason = @reason, updatedAt = GETDATE()
        WHERE id = @studentId
      `);
    
    // Send rejection email
    await sendEmail(
      application.email,
      'Application Status Update - Smart Admission Portal',
      `
        <h2>Application Status Update</h2>
        <p>Hello ${application.firstName},</p>
        <p>Thank you for your interest in our institution. After careful review, we regret to inform you that your admission application has not been approved at this time.</p>
        <p><strong>Application Number:</strong> ${application.applicationNumber}</p>
        <p><strong>Reason:</strong> ${reason}</p>
        <p>We encourage you to reapply in the future. If you have any questions, please don't hesitate to contact us.</p>
        <p>Best regards,<br>Smart Admission Portal Team</p>
      `
    );

    // Send notification to admin
    await sendEmail(
      config.adminEmail,
      'Application Rejected - Smart Admission Portal',
      `
        <h2>Application Rejected</h2>
        <p>An application has been rejected:</p>
        <ul>
          <li><strong>Student:</strong> ${application.firstName} ${application.lastName}</li>
          <li><strong>Application Number:</strong> ${application.applicationNumber}</li>
          <li><strong>Reason:</strong> ${reason}</li>
          <li><strong>Rejected By:</strong> Admin</li>
          <li><strong>Rejected On:</strong> ${new Date().toLocaleString()}</li>
        </ul>
      `
    );
    
    res.json({
      success: true,
      message: 'Application rejected successfully'
    });
    
  } catch (error) {
    console.error('Reject application error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to reject application',
      error: error.message
    });
  }
});

// Get all documents for review
router.get('/documents', async (req, res) => {
  try {
    const { page = 1, limit = 10, status, studentId } = req.query;
    const offset = (page - 1) * limit;
    
    const pool = getPool();
    
    let whereClause = "WHERE 1=1";
    if (status) {
      whereClause += ` AND d.status = '${status}'`;
    }
    if (studentId) {
      whereClause += ` AND d.studentId = '${studentId}'`;
    }
    
    const documentsResult = await pool.request()
      .query(`
        SELECT 
          d.*,
          dt.name as documentTypeName,
          s.applicationNumber,
          CONCAT(u.firstName, ' ', u.lastName) as studentName
        FROM documents d
        INNER JOIN document_types dt ON d.documentTypeId = dt.id
        INNER JOIN students s ON d.studentId = s.id
        INNER JOIN users u ON s.userId = u.id
        ${whereClause}
        ORDER BY d.uploadedAt DESC
        OFFSET ${offset} ROWS
        FETCH NEXT ${limit} ROWS ONLY
      `);
    
    const countResult = await pool.request()
      .query(`
        SELECT COUNT(*) as total
        FROM documents d
        INNER JOIN document_types dt ON d.documentTypeId = dt.id
        INNER JOIN students s ON d.studentId = s.id
        INNER JOIN users u ON s.userId = u.id
        ${whereClause}
      `);
    
    const total = countResult.recordset[0].total;
    
    res.json({
      success: true,
      data: documentsResult.recordset,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: total,
        totalPages: Math.ceil(total / limit)
      }
    });
    
  } catch (error) {
    console.error('Get documents error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get documents',
      error: error.message
    });
  }
});

// Approve document
router.post('/documents/:id/approve', async (req, res) => {
  try {
    const { id } = req.params;
    const { notes } = req.body;
    const pool = getPool();
    
    await pool.request()
      .input('documentId', sql.UniqueIdentifier, id)
      .input('approvedBy', sql.UniqueIdentifier, req.user.userId)
      .input('notes', sql.NVarChar, notes)
      .query(`
        UPDATE documents
        SET 
          status = 'approved',
          approvedBy = @approvedBy,
          approvedAt = GETDATE(),
          adminNotes = @notes
        WHERE id = @documentId
      `);
    
    res.json({
      success: true,
      message: 'Document approved successfully'
    });
    
  } catch (error) {
    console.error('Approve document error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to approve document',
      error: error.message
    });
  }
});

// Reject document
router.post('/documents/:id/reject', async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    const pool = getPool();
    
    await pool.request()
      .input('documentId', sql.UniqueIdentifier, id)
      .input('reason', sql.NVarChar, reason)
      .query(`
        UPDATE documents
        SET 
          status = 'rejected',
          rejectedAt = GETDATE(),
          rejectionReason = @reason
        WHERE id = @documentId
      `);
    
    res.json({
      success: true,
      message: 'Document rejected successfully'
    });
    
  } catch (error) {
    console.error('Reject document error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to reject document',
      error: error.message
    });
  }
});

// Get payment statistics
router.get('/payments/stats', async (req, res) => {
  try {
    const pool = getPool();
    
    const statsResult = await pool.request()
      .query(`
        SELECT 
          (SELECT ISNULL(SUM(amount), 0) FROM payments WHERE status = 'completed') as totalRevenue,
          (SELECT COUNT(*) FROM payments WHERE status = 'pending') as pendingPayments,
          (SELECT COUNT(*) FROM payments WHERE status = 'completed') as completedPayments,
          (SELECT COUNT(*) FROM payments WHERE status = 'failed') as failedPayments
      `);
    
    const stats = statsResult.recordset[0];
    
    res.json({
      success: true,
      data: {
        totalRevenue: stats.totalRevenue || 0,
        pendingPayments: stats.pendingPayments || 0,
        completedPayments: stats.completedPayments || 0,
        failedPayments: stats.failedPayments || 0
      }
    });
    
  } catch (error) {
    console.error('Get payment stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get payment stats',
      error: error.message
    });
  }
});

// Get all payments
router.get('/payments', async (req, res) => {
  try {
    const { page = 1, limit = 10, status, search } = req.query;
    const offset = (page - 1) * limit;
    
    const pool = getPool();
    
    let whereClause = "WHERE 1=1";
    if (status) {
      whereClause += ` AND p.status = '${status}'`;
    }
    if (search) {
      whereClause += ` AND (s.applicationNumber LIKE '%${search}%' OR u.firstName LIKE '%${search}%' OR u.lastName LIKE '%${search}%' OR p.transactionId LIKE '%${search}%')`;
    }
    
    const paymentsResult = await pool.request()
      .query(`
        SELECT 
          p.id,
          p.studentId,
          CONCAT(u.firstName, ' ', u.lastName) as studentName,
          s.applicationNumber,
          p.amount,
          p.currency,
          p.paymentMethod,
          p.transactionId,
          p.status,
          p.paidAt,
          p.createdAt,
          p.installmentNumber,
          p.totalInstallments
        FROM payments p
        INNER JOIN students s ON p.studentId = s.id
        INNER JOIN users u ON s.userId = u.id
        ${whereClause}
        ORDER BY p.createdAt DESC
        OFFSET ${offset} ROWS
        FETCH NEXT ${limit} ROWS ONLY
      `);
    
    const countResult = await pool.request()
      .query(`
        SELECT COUNT(*) as total
        FROM payments p
        INNER JOIN students s ON p.studentId = s.id
        INNER JOIN users u ON s.userId = u.id
        ${whereClause}
      `);
    
    const total = countResult.recordset[0].total;
    
    res.json({
      success: true,
      data: paymentsResult.recordset,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: total,
        totalPages: Math.ceil(total / limit)
      }
    });
    
  } catch (error) {
    console.error('Get payments error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get payments',
      error: error.message
    });
  }
});

// Add payment (cash, by admin)
router.post('/payments', requireRole('admin'), async (req, res) => {
  try {
    const { studentId, amount, paymentMethod, status, receivingPerson } = req.body;
    if (!studentId || !amount || !paymentMethod || !status || !receivingPerson) {
      return res.status(400).json({ success: false, message: 'All fields are required' });
    }
    const pool = getPool();
    const paymentId = uuidv4();
    // Compose paymentMethod with receiving person
    const paymentMethodWithPerson = `${paymentMethod} (${receivingPerson})`;
    await pool.request()
      .input('id', sql.UniqueIdentifier, paymentId)
      .input('studentId', sql.UniqueIdentifier, studentId)
      .input('amount', sql.Decimal(10, 2), amount)
      .input('paymentMethod', sql.NVarChar, paymentMethodWithPerson)
      .input('status', sql.NVarChar, status)
      .input('transactionId', sql.NVarChar, `CASH${Date.now()}`)
      .input('paidAt', sql.DateTime2, status === 'completed' ? new Date() : null)
      .query(`
        INSERT INTO payments (id, studentId, amount, paymentMethod, status, transactionId, paidAt)
        VALUES (@id, @studentId, @amount, @paymentMethod, @status, @transactionId, @paidAt)
      `);
    res.json({ success: true, message: 'Cash payment recorded', data: { id: paymentId } });
  } catch (error) {
    console.error('Admin cash payment error:', error);
    res.status(500).json({ success: false, message: 'Failed to record cash payment', error: error.message });
  }
});

// Master data routes
router.get('/master/:type', async (req, res) => {
  try {
    const { type } = req.params;
    const pool = getPool();
    
    let query = '';
    switch (type) {
      case 'countries':
        query = 'SELECT * FROM countries ORDER BY name';
        break;
      case 'states':
        query = 'SELECT * FROM states ORDER BY name';
        break;
      case 'cities':
        query = 'SELECT * FROM cities ORDER BY name';
        break;
      case 'colleges':
        query = 'SELECT * FROM colleges ORDER BY name';
        break;
      case 'branches':
        query = 'SELECT * FROM branches ORDER BY name';
        break;
      case 'trades':
        query = 'SELECT * FROM trades ORDER BY name';
        break;
      case 'document-types':
        query = 'SELECT * FROM document_types ORDER BY sortOrder';
        break;
      case 'fees':
        query = 'SELECT * FROM fees ORDER BY feeType';
        break;
      default:
        return res.status(400).json({
          success: false,
          message: 'Invalid master data type'
        });
    }
    
    const result = await pool.request().query(query);
    
    res.json({
      success: true,
      data: result.recordset
    });
    
  } catch (error) {
    console.error('Get master data error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get master data',
      error: error.message
    });
  }
});

// Country master controller
router.post('/countries/control', async (req, res) => {
  const { type, id, name, code, isActive } = req.body;
  const pool = getPool();

  try {
    if (type === 1) {
      // Get all countries with student and state counts
      const countriesResult = await pool.request().query(`
        SELECT id, name, code, isActive, createdAt FROM countries
      `);
      const countries = countriesResult.recordset;
      // Get counts for each country
      for (const country of countries) {
        const studentCountResult = await pool.request()
          .input('countryId', sql.UniqueIdentifier, country.id)
          .query('SELECT COUNT(*) as count FROM students WHERE countryId = @countryId');
        const stateCountResult = await pool.request()
          .input('countryId', sql.UniqueIdentifier, country.id)
          .query('SELECT COUNT(*) as count FROM states WHERE countryId = @countryId');
        country.studentCount = studentCountResult.recordset[0].count;
        country.stateCount = stateCountResult.recordset[0].count;
      }
      return res.json({ success: true, data: countries });
    }
    if (type === 2) {
      // Create country
      if (!name || !code) return res.status(400).json({ success: false, message: 'Name and code required' });
      const newId = uuidv4();
      await pool.request()
        .input('id', sql.UniqueIdentifier, newId)
        .input('name', sql.NVarChar, name)
        .input('code', sql.NVarChar, code)
        .input('isActive', sql.Bit, isActive === undefined ? 1 : isActive ? 1 : 0)
        .input('createdAt', sql.DateTime, new Date())
        .query('INSERT INTO countries (id, name, code, isActive, createdAt) VALUES (@id, @name, @code, @isActive, @createdAt)');
      return res.json({ success: true, message: 'Country created' });
    }
    if (type === 3) {
      // Update country
      if (!id || !name || !code) return res.status(400).json({ success: false, message: 'ID, name, and code required' });
      await pool.request()
        .input('id', sql.UniqueIdentifier, id)
        .input('name', sql.NVarChar, name)
        .input('code', sql.NVarChar, code)
        .input('isActive', sql.Bit, isActive === undefined ? 1 : isActive ? 1 : 0)
        .query('UPDATE countries SET name=@name, code=@code, isActive=@isActive WHERE id=@id');
      return res.json({ success: true, message: 'Country updated' });
    }
    if (type === 4) {
      // Delete country (only if no students or states)
      if (!id) return res.status(400).json({ success: false, message: 'ID required' });
      const studentCountResult = await pool.request()
        .input('countryId', sql.UniqueIdentifier, id)
        .query('SELECT COUNT(*) as count FROM students WHERE countryId = @countryId');
      const stateCountResult = await pool.request()
        .input('countryId', sql.UniqueIdentifier, id)
        .query('SELECT COUNT(*) as count FROM states WHERE countryId = @countryId');
      if (studentCountResult.recordset[0].count > 0)
        return res.status(400).json({ success: false, message: 'Cannot delete: students registered under this country' });
      if (stateCountResult.recordset[0].count > 0)
        return res.status(400).json({ success: false, message: 'Cannot delete: states registered under this country' });
      await pool.request()
        .input('id', sql.UniqueIdentifier, id)
        .query('DELETE FROM countries WHERE id=@id');
      return res.json({ success: true, message: 'Country deleted' });
    }
    return res.status(400).json({ success: false, message: 'Invalid type' });
  } catch (error) {
    console.error('Country control error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
});

// State master controller
router.post('/states/control', async (req, res) => {
  const { type, id, countryId, name, code, isActive } = req.body;
  const pool = getPool();
  try {
    if (type === 1) {
      // Get all states with student and city counts
      const statesResult = await pool.request().query(`
        SELECT id, countryId, name, code, isActive, createdAt FROM states
      `);
      const states = statesResult.recordset;
      for (const state of states) {
        const studentCountResult = await pool.request()
          .input('stateId', sql.UniqueIdentifier, state.id)
          .query('SELECT COUNT(*) as count FROM students WHERE stateId = @stateId');
        const cityCountResult = await pool.request()
          .input('stateId', sql.UniqueIdentifier, state.id)
          .query('SELECT COUNT(*) as count FROM cities WHERE stateId = @stateId');
        state.studentCount = studentCountResult.recordset[0].count;
        state.cityCount = cityCountResult.recordset[0].count;
      }
      return res.json({ success: true, data: states });
    }
    if (type === 2) {
      // Create state
      if (!countryId || !name || !code) return res.status(400).json({ success: false, message: 'Country, name and code required' });
      const newId = uuidv4();
      await pool.request()
        .input('id', sql.UniqueIdentifier, newId)
        .input('countryId', sql.UniqueIdentifier, countryId)
        .input('name', sql.NVarChar, name)
        .input('code', sql.NVarChar, code)
        .input('isActive', sql.Bit, isActive === undefined ? 1 : isActive ? 1 : 0)
        .input('createdAt', sql.DateTime, new Date())
        .query('INSERT INTO states (id, countryId, name, code, isActive, createdAt) VALUES (@id, @countryId, @name, @code, @isActive, @createdAt)');
      return res.json({ success: true, message: 'State created' });
    }
    if (type === 3) {
      // Update state
      if (!id || !countryId || !name || !code) return res.status(400).json({ success: false, message: 'ID, country, name, and code required' });
      await pool.request()
        .input('id', sql.UniqueIdentifier, id)
        .input('countryId', sql.UniqueIdentifier, countryId)
        .input('name', sql.NVarChar, name)
        .input('code', sql.NVarChar, code)
        .input('isActive', sql.Bit, isActive === undefined ? 1 : isActive ? 1 : 0)
        .query('UPDATE states SET countryId=@countryId, name=@name, code=@code, isActive=@isActive WHERE id=@id');
      return res.json({ success: true, message: 'State updated' });
    }
    if (type === 4) {
      // Delete state (only if no students or cities)
      if (!id) return res.status(400).json({ success: false, message: 'ID required' });
      const studentCountResult = await pool.request()
        .input('stateId', sql.UniqueIdentifier, id)
        .query('SELECT COUNT(*) as count FROM students WHERE stateId = @stateId');
      const cityCountResult = await pool.request()
        .input('stateId', sql.UniqueIdentifier, id)
        .query('SELECT COUNT(*) as count FROM cities WHERE stateId = @stateId');
      if (studentCountResult.recordset[0].count > 0)
        return res.status(400).json({ success: false, message: 'Cannot delete: students registered under this state' });
      if (cityCountResult.recordset[0].count > 0)
        return res.status(400).json({ success: false, message: 'Cannot delete: cities registered under this state' });
      await pool.request()
        .input('id', sql.UniqueIdentifier, id)
        .query('DELETE FROM states WHERE id=@id');
      return res.json({ success: true, message: 'State deleted' });
    }
    return res.status(400).json({ success: false, message: 'Invalid type' });
  } catch (error) {
    console.error('State control error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
});

// City master controller
router.post('/cities/control', async (req, res) => {
  const { type, id, stateId, name, isActive } = req.body;
  const pool = getPool();
  try {
    if (type === 1) {
      // Get all cities with student count
      const citiesResult = await pool.request().query(`
        SELECT id, stateId, name, isActive, createdAt FROM cities
      `);
      const cities = citiesResult.recordset;
      for (const city of cities) {
        const studentCountResult = await pool.request()
          .input('cityId', sql.UniqueIdentifier, city.id)
          .query('SELECT COUNT(*) as count FROM students WHERE cityId = @cityId');
        city.studentCount = studentCountResult.recordset[0].count;
      }
      return res.json({ success: true, data: cities });
    }
    if (type === 2) {
      // Create city
      if (!stateId || !name) return res.status(400).json({ success: false, message: 'State and name required' });
      const newId = uuidv4();
      await pool.request()
        .input('id', sql.UniqueIdentifier, newId)
        .input('stateId', sql.UniqueIdentifier, stateId)
        .input('name', sql.NVarChar, name)
        .input('isActive', sql.Bit, isActive === undefined ? 1 : isActive ? 1 : 0)
        .input('createdAt', sql.DateTime, new Date())
        .query('INSERT INTO cities (id, stateId, name, isActive, createdAt) VALUES (@id, @stateId, @name, @isActive, @createdAt)');
      return res.json({ success: true, message: 'City created' });
    }
    if (type === 3) {
      // Update city
      if (!id || !stateId || !name) return res.status(400).json({ success: false, message: 'ID, state, and name required' });
      await pool.request()
        .input('id', sql.UniqueIdentifier, id)
        .input('stateId', sql.UniqueIdentifier, stateId)
        .input('name', sql.NVarChar, name)
        .input('isActive', sql.Bit, isActive === undefined ? 1 : isActive ? 1 : 0)
        .query('UPDATE cities SET stateId=@stateId, name=@name, isActive=@isActive WHERE id=@id');
      return res.json({ success: true, message: 'City updated' });
    }
    if (type === 4) {
      // Delete city (only if no students)
      if (!id) return res.status(400).json({ success: false, message: 'ID required' });
      const studentCountResult = await pool.request()
        .input('cityId', sql.UniqueIdentifier, id)
        .query('SELECT COUNT(*) as count FROM students WHERE cityId = @cityId');
      if (studentCountResult.recordset[0].count > 0)
        return res.status(400).json({ success: false, message: 'Cannot delete: students registered under this city' });
      await pool.request()
        .input('id', sql.UniqueIdentifier, id)
        .query('DELETE FROM cities WHERE id=@id');
      return res.json({ success: true, message: 'City deleted' });
    }
    return res.status(400).json({ success: false, message: 'Invalid type' });
  } catch (error) {
    console.error('City control error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
});

module.exports = router;