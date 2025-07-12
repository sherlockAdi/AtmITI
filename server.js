const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const { initializeDatabase } = require('./database');
const authRoutes = require('./routes/auth');
const studentRoutes = require('./routes/student');
const adminRoutes = require('./routes/admin');
const masterRoutes = require('./routes/master');
const dashboardRoutes = require('./routes/dashboard');
const filesRoutes = require('./routes/files');
const { errorHandler } = require('./middleware/errorHandler');

const app = express();
const PORT = process.env.PORT || 4000;
const HOST = 'localhost';

// ===== 🌐 Security Headers for Blob + PDF.js =====
app.use((req, res, next) => {
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  next();
});

// ===== 🛡️ Helmet + CSP =====
app.use(helmet());

// Updated CSP for blob and PDF rendering
app.use(
  helmet.contentSecurityPolicy({
    directives: {
      defaultSrc: ["'self'", "blob:"],
      scriptSrc: ["'self'", "https://unpkg.com"],
      workerSrc: ["'self'", "blob:"],
      objectSrc: ["'none'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'"],
      frameSrc: ["'self'", "blob:"],
    },
  })
);

// ===== 🔓 CORS =====
app.use(cors({
  origin: '*',
  credentials: true, // note: with origin '*' credentials doesn't take effect
}));

// ===== 🛡️ Rate Limiting =====
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});
app.use('/api/', limiter);

// ===== 🔧 Middleware =====
app.use(compression());
app.use(morgan('combined'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ===== 📦 Serve Static Files (Vite Build) =====
const path = require('path');
app.use(express.static(path.join(__dirname, 'dist')));

// ===== 📁 Routes =====
app.use('/api/auth', authRoutes);
app.use('/api/student', studentRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/master', masterRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/files', filesRoutes);

// ===== 🔍 Health Check =====
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// ===== 🔁 Catch-All for Frontend Routing =====
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api')) {
    res.sendFile(path.join(__dirname, 'dist', 'index.html'));
  } else {
    res.status(404).json({ error: 'API route not found' });
  }
});

// ===== 🧯 Error Handling =====
app.use(errorHandler);

// ===== 🛠️ Log Registered Routes (Optional Debugging) =====
app._router.stack.forEach(r => {
  if (r.route && r.route.path) {
    console.log(r.route.path);
  }
});

// ===== 🚀 Start Server =====
initializeDatabase()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Server running on http://${HOST}:${PORT}`);
      console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
    });
  })
  .catch((error) => {
    console.error('Failed to initialize database:', error);
    process.exit(1);
  });

module.exports = app;
