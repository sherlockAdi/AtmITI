module.exports = {
  mssql: {
    user: 'multi',
    password: '67@rohit',
    server: '103.20.215.109',
    port: 9851,
    database: 'dbtplastic',
    options: {
      encrypt: false,
      trustServerCertificate: true,
    },
  },
  jwtSecret: process.env.JWT_SECRET || 'aditya@123',
  b2: {
    endpoint: 'https://s3.us-west-002.backblazeb2.com',
    accessKeyId: '0057769a9a066d60000000004',
    secretAccessKey: 'K005xYfidpibPYD26PfXWxQyTqpedbA',
    bucket: 'mydrive-files',
    region: 'us-west-002',
  },
  smtp: {
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: {
      user: 'sw2@atm.edu.in',
      pass: 'hpht nnua txzr wlhl'
    }
  },
  adminEmail: 'akdwivedi7355@gmail.com'
};