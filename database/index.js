const sql = require('mssql');
const config = require('../config');

let pool;

const initializeDatabase = async () => {
  try {
    pool = await sql.connect(config.mssql);
    console.log('Connected to MSSQL database');
    
    // Create tables if they don't exist
    await createTables();
    
    return pool;
  } catch (error) {
    console.error('Database connection error:', error);
    throw error;
  }
};

const createTables = async () => {
  try {
    const request = new sql.Request(pool);
    
    // Users table
    await request.query(`
      IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='users' AND xtype='U')
      CREATE TABLE users (
        id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
        email NVARCHAR(255) UNIQUE NOT NULL,
        phone NVARCHAR(20) NOT NULL,
        firstName NVARCHAR(100) NOT NULL,
        lastName NVARCHAR(100) NOT NULL,
        password NVARCHAR(255) NOT NULL,
        isEmailVerified BIT DEFAULT 0,
        isPhoneVerified BIT DEFAULT 0,
        role NVARCHAR(20) DEFAULT 'student',
        createdAt DATETIME2 DEFAULT GETDATE(),
        updatedAt DATETIME2 DEFAULT GETDATE()
      )
    `);

    // Students table
    await request.query(`
      IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='students' AND xtype='U')
      CREATE TABLE students (
        id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
        userId UNIQUEIDENTIFIER NOT NULL FOREIGN KEY REFERENCES users(id),
        applicationNumber NVARCHAR(20) UNIQUE NOT NULL,
        countryId UNIQUEIDENTIFIER,
        stateId UNIQUEIDENTIFIER,
        cityId UNIQUEIDENTIFIER,
        collegeId UNIQUEIDENTIFIER,
        branchId UNIQUEIDENTIFIER,
        tradeId UNIQUEIDENTIFIER,
        dateOfBirth DATE,
        gender NVARCHAR(10),
        category NVARCHAR(20),
        fatherName NVARCHAR(100),
        motherName NVARCHAR(100),
        guardianName NVARCHAR(100),
        address NVARCHAR(500),
        pincode NVARCHAR(10),
        status NVARCHAR(20) DEFAULT 'draft',
        submittedAt DATETIME2,
        approvedAt DATETIME2,
        rejectedAt DATETIME2,
        rejectionReason NVARCHAR(500),
        createdAt DATETIME2 DEFAULT GETDATE(),
        updatedAt DATETIME2 DEFAULT GETDATE()
      )
    `);

    // Countries table
    await request.query(`
      IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='countries' AND xtype='U')
      CREATE TABLE countries (
        id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
        name NVARCHAR(100) NOT NULL,
        code NVARCHAR(10) NOT NULL,
        isActive BIT DEFAULT 1,
        createdAt DATETIME2 DEFAULT GETDATE()
      )
    `);

    // States table
    await request.query(`
      IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='states' AND xtype='U')
      CREATE TABLE states (
        id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
        countryId UNIQUEIDENTIFIER NOT NULL FOREIGN KEY REFERENCES countries(id),
        name NVARCHAR(100) NOT NULL,
        code NVARCHAR(10) NOT NULL,
        isActive BIT DEFAULT 1,
        createdAt DATETIME2 DEFAULT GETDATE()
      )
    `);

    // Cities table
    await request.query(`
      IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='cities' AND xtype='U')
      CREATE TABLE cities (
        id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
        stateId UNIQUEIDENTIFIER NOT NULL FOREIGN KEY REFERENCES states(id),
        name NVARCHAR(100) NOT NULL,
        isActive BIT DEFAULT 1,
        createdAt DATETIME2 DEFAULT GETDATE()
      )
    `);

    // Colleges table
    await request.query(`
      IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='colleges' AND xtype='U')
      CREATE TABLE colleges (
        id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
        name NVARCHAR(200) NOT NULL,
        code NVARCHAR(20) NOT NULL,
        address NVARCHAR(500),
        cityId UNIQUEIDENTIFIER FOREIGN KEY REFERENCES cities(id),
        establishedYear INT,
        isActive BIT DEFAULT 1,
        createdAt DATETIME2 DEFAULT GETDATE()
      )
    `);

    // Branches table
    await request.query(`
      IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='branches' AND xtype='U')
      CREATE TABLE branches (
        id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
        name NVARCHAR(200) NOT NULL,
        code NVARCHAR(20) NOT NULL,
        description NVARCHAR(500),
        isActive BIT DEFAULT 1,
        createdAt DATETIME2 DEFAULT GETDATE()
      )
    `);

    // Trades table
    await request.query(`
      IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='trades' AND xtype='U')
      CREATE TABLE trades (
        id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
        branchId UNIQUEIDENTIFIER NOT NULL FOREIGN KEY REFERENCES branches(id),
        name NVARCHAR(200) NOT NULL,
        code NVARCHAR(20) NOT NULL,
        description NVARCHAR(500),
        duration INT,
        isActive BIT DEFAULT 1,
        createdAt DATETIME2 DEFAULT GETDATE()
      )
    `);

    // Document types table
    await request.query(`
      IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='document_types' AND xtype='U')
      CREATE TABLE document_types (
        id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
        name NVARCHAR(200) NOT NULL,
        description NVARCHAR(500),
        isRequired BIT DEFAULT 1,
        maxFileSize INT DEFAULT 5242880,
        allowedTypes NVARCHAR(200) DEFAULT 'application/pdf,image/jpeg,image/png',
        sortOrder INT DEFAULT 0,
        isActive BIT DEFAULT 1,
        createdAt DATETIME2 DEFAULT GETDATE()
      )
    `);

    // Documents table
    await request.query(`
      IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='documents' AND xtype='U')
      CREATE TABLE documents (
        id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
        studentId UNIQUEIDENTIFIER NOT NULL FOREIGN KEY REFERENCES students(id),
        documentTypeId UNIQUEIDENTIFIER NOT NULL FOREIGN KEY REFERENCES document_types(id),
        fileName NVARCHAR(255) NOT NULL,
        originalName NVARCHAR(255) NOT NULL,
        filePath NVARCHAR(500) NOT NULL,
        fileSize BIGINT NOT NULL,
        mimeType NVARCHAR(100) NOT NULL,
        uploadedAt DATETIME2 DEFAULT GETDATE(),
        status NVARCHAR(20) DEFAULT 'pending',
        approvedBy UNIQUEIDENTIFIER,
        approvedAt DATETIME2,
        rejectedAt DATETIME2,
        rejectionReason NVARCHAR(500),
        adminNotes NVARCHAR(1000)
      )
    `);

    // Fees table
    await request.query(`
      IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='fees' AND xtype='U')
      CREATE TABLE fees (
        id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
        tradeId UNIQUEIDENTIFIER NOT NULL FOREIGN KEY REFERENCES trades(id),
        feeType NVARCHAR(50) NOT NULL,
        amount DECIMAL(10,2) NOT NULL,
        currency NVARCHAR(3) DEFAULT 'INR',
        isActive BIT DEFAULT 1,
        academicYear NVARCHAR(10),
        createdAt DATETIME2 DEFAULT GETDATE()
      )
    `);

    // Payments table
    await request.query(`
      IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='payments' AND xtype='U')
      CREATE TABLE payments (
        id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
        studentId UNIQUEIDENTIFIER NOT NULL FOREIGN KEY REFERENCES students(id),
        feeId UNIQUEIDENTIFIER FOREIGN KEY REFERENCES fees(id),
        amount DECIMAL(10,2) NOT NULL,
        currency NVARCHAR(3) DEFAULT 'INR',
        paymentMethod NVARCHAR(20) DEFAULT 'online',
        transactionId NVARCHAR(100),
        status NVARCHAR(20) DEFAULT 'pending',
        paidAt DATETIME2,
        createdAt DATETIME2 DEFAULT GETDATE(),
        installmentNumber INT DEFAULT 1,
        totalInstallments INT DEFAULT 1
      )
    `);
    // Add receivingPerson column if not exists
    await request.query(`
      IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'payments' AND COLUMN_NAME = 'receivingPerson')
      ALTER TABLE payments ADD receivingPerson NVARCHAR(100) NULL
    `);

    // Payment plans table
    await request.query(`
      IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='payment_plans' AND xtype='U')
      CREATE TABLE payment_plans (
        id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
        studentId UNIQUEIDENTIFIER NOT NULL FOREIGN KEY REFERENCES students(id),
        totalAmount DECIMAL(10,2) NOT NULL,
        paidAmount DECIMAL(10,2) DEFAULT 0,
        remainingAmount DECIMAL(10,2) NOT NULL,
        installments INT DEFAULT 1,
        installmentAmount DECIMAL(10,2) NOT NULL,
        nextDueDate DATETIME2,
        status NVARCHAR(20) DEFAULT 'active',
        createdAt DATETIME2 DEFAULT GETDATE()
      )
    `);

    // Verification codes table
    await request.query(`
      IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='verification_codes' AND xtype='U')
      CREATE TABLE verification_codes (
        id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
        email NVARCHAR(255),
        phone NVARCHAR(20),
        code NVARCHAR(10) NOT NULL,
        type NVARCHAR(20) NOT NULL,
        expiresAt DATETIME2 NOT NULL,
        isUsed BIT DEFAULT 0,
        createdAt DATETIME2 DEFAULT GETDATE()
      )
    `);

    // Insert default data
    await insertDefaultData();

    console.log('Database tables created successfully');
  } catch (error) {
    console.error('Error creating tables:', error);
    throw error;
  }
};

const insertDefaultData = async () => {
  try {
    const request = new sql.Request(pool);
    
    // Insert default country (India)
    await request.query(`
      IF NOT EXISTS (SELECT * FROM countries WHERE code = 'IN')
      INSERT INTO countries (name, code) VALUES ('India', 'IN')
    `);

    // Insert default states
    await request.query(`
      IF NOT EXISTS (SELECT * FROM states WHERE code = 'UP')
      INSERT INTO states (countryId, name, code) 
      SELECT id, 'Uttar Pradesh', 'UP' FROM countries WHERE code = 'IN'
    `);

    // Insert default document types
    await request.query(`
      IF NOT EXISTS (SELECT * FROM document_types WHERE name = 'Birth Certificate')
      INSERT INTO document_types (name, description, isRequired, sortOrder) 
      VALUES ('Birth Certificate', 'Official birth certificate', 1, 1)
    `);

    await request.query(`
      IF NOT EXISTS (SELECT * FROM document_types WHERE name = 'Identity Proof')
      INSERT INTO document_types (name, description, isRequired, sortOrder) 
      VALUES ('Identity Proof', 'Aadhaar card or passport', 1, 2)
    `);

    await request.query(`
      IF NOT EXISTS (SELECT * FROM document_types WHERE name = 'Educational Certificate')
      INSERT INTO document_types (name, description, isRequired, sortOrder) 
      VALUES ('Educational Certificate', 'Last educational qualification certificate', 1, 3)
    `);

    // Insert default branches
    await request.query(`
      IF NOT EXISTS (SELECT * FROM branches WHERE code = 'ENG')
      INSERT INTO branches (name, code, description) 
      VALUES ('Engineering', 'ENG', 'Engineering courses')
    `);

    await request.query(`
      IF NOT EXISTS (SELECT * FROM branches WHERE code = 'MED')
      INSERT INTO branches (name, code, description) 
      VALUES ('Medical', 'MED', 'Medical courses')
    `);

    console.log('Default data inserted successfully');
  } catch (error) {
    console.error('Error inserting default data:', error);
  }
};

const getPool = () => {
  if (!pool) {
    throw new Error('Database not initialized');
  }
  return pool;
};

module.exports = {
  initializeDatabase,
  getPool,
  sql
};