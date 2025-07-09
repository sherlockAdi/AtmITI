const express = require('express');
const { getPool, sql } = require('../database');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Get dashboard stats
router.get('/stats', authenticateToken, async (req, res) => {
  try {
    const pool = getPool();
    
    const statsResult = await pool.request()
      .query(`
        SELECT 
          (SELECT COUNT(*) FROM students) as totalApplications,
          (SELECT COUNT(*) FROM students WHERE status = 'under_review') as pendingReviews,
          (SELECT COUNT(*) FROM payments WHERE status = 'completed') as completedPayments,
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

// Get recent applications
router.get('/recent-applications', authenticateToken, async (req, res) => {
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

module.exports = router;