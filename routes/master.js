const express = require('express');
const { getPool, sql } = require('../database');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Get countries
router.get('/countries', async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request()
      .query('SELECT id, name, code FROM countries WHERE isActive = 1 ORDER BY name');
    
    res.json({
      success: true,
      data: result.recordset
    });
  } catch (error) {
    console.error('Get countries error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get countries',
      error: error.message
    });
  }
});

// Get states by country
router.get('/states', async (req, res) => {
  try {
    const { countryId } = req.query;
    const pool = getPool();
    
    const result = await pool.request()
      .input('countryId', sql.UniqueIdentifier, countryId)
      .query('SELECT id, name, code FROM states WHERE countryId = @countryId AND isActive = 1 ORDER BY name');
    
    res.json({
      success: true,
      data: result.recordset
    });
  } catch (error) {
    console.error('Get states error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get states',
      error: error.message
    });
  }
});

// Get cities by state
router.get('/cities', async (req, res) => {
  try {
    const { stateId } = req.query;
    const pool = getPool();
    
    const result = await pool.request()
      .input('stateId', sql.UniqueIdentifier, stateId)
      .query('SELECT id, name FROM cities WHERE stateId = @stateId AND isActive = 1 ORDER BY name');
    
    res.json({
      success: true,
      data: result.recordset
    });
  } catch (error) {
    console.error('Get cities error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get cities',
      error: error.message
    });
  }
});

// Get colleges
router.get('/colleges', async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request()
      .query('SELECT id, name, code, address FROM colleges WHERE isActive = 1 ORDER BY name');
    
    res.json({
      success: true,
      data: result.recordset
    });
  } catch (error) {
    console.error('Get colleges error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get colleges',
      error: error.message
    });
  }
});

// Get branches
router.get('/branches', async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request()
      .query('SELECT id, name, code, description FROM branches WHERE isActive = 1 ORDER BY name');
    
    res.json({
      success: true,
      data: result.recordset
    });
  } catch (error) {
    console.error('Get branches error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get branches',
      error: error.message
    });
  }
});

// Get trades by branch
router.get('/trades', async (req, res) => {
  try {
    const { branchId } = req.query;
    const pool = getPool();
    
    const result = await pool.request()
      .input('branchId', sql.UniqueIdentifier, branchId)
      .query('SELECT id, name, code, description, duration FROM trades WHERE branchId = @branchId AND isActive = 1 ORDER BY name');
    
    res.json({
      success: true,
      data: result.recordset
    });
  } catch (error) {
    console.error('Get trades error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get trades',
      error: error.message
    });
  }
});

// Get document types
router.get('/document-types', async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request()
      .query('SELECT id, name, description, isRequired, maxFileSize, allowedTypes FROM document_types WHERE isActive = 1 ORDER BY sortOrder');
    
    const documentTypes = result.recordset.map(dt => ({
      ...dt,
      allowedTypes: dt.allowedTypes.split(',')
    }));
    
    res.json({
      success: true,
      data: documentTypes
    });
  } catch (error) {
    console.error('Get document types error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get document types',
      error: error.message
    });
  }
});

// Get fee structure by trade
router.get('/fee-structure', async (req, res) => {
  try {
    const { tradeId } = req.query;
    const pool = getPool();
    
    const result = await pool.request()
      .input('tradeId', sql.UniqueIdentifier, tradeId)
      .query('SELECT id, feeType, amount, currency FROM fees WHERE tradeId = @tradeId AND isActive = 1 ORDER BY feeType');
    
    res.json({
      success: true,
      data: result.recordset
    });
  } catch (error) {
    console.error('Get fee structure error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get fee structure',
      error: error.message
    });
  }
});

module.exports = router;