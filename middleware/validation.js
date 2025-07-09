const { body, validationResult } = require('express-validator');

const validateRequest = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array()
    });
  }
  next();
};

const registerValidation = [
  body('firstName')
    .notEmpty()
    .withMessage('First name is required')
    .isLength({ min: 2, max: 50 })
    .withMessage('First name must be between 2 and 50 characters'),
  
  body('lastName')
    .notEmpty()
    .withMessage('Last name is required')
    .isLength({ min: 2, max: 50 })
    .withMessage('Last name must be between 2 and 50 characters'),
  
  body('email')
    .isEmail()
    .withMessage('Please provide a valid email')
    .normalizeEmail(),
  
  body('phone')
    .isMobilePhone('en-IN')
    .withMessage('Please provide a valid Indian phone number'),
  
  body('password')
    // .isLength({ min: 8 })
    // .withMessage('Password must be at least 8 characters long')
    // .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    // .withMessage('Password must contain at least one lowercase letter, one uppercase letter, and one number'),
];

const loginValidation = [
  body().custom(body => {
    if ((!body.email || body.email === '') && (!body.phone || body.phone === '')) {
      throw new Error('Either email or phone is required');
    }
    return true;
  }),
  body('email')
    .optional()
    .isEmail()
    .withMessage('Please provide a valid email')
    .normalizeEmail(),
  body('phone')
    .optional()
    .isMobilePhone('en-IN')
    .withMessage('Please provide a valid Indian phone number'),
  body('password')
    .notEmpty()
    .withMessage('Password is required'),
];

const personalInfoValidation = [
  body('firstName').notEmpty().withMessage('First name is required'),
  body('lastName').notEmpty().withMessage('Last name is required'),
  body('email').isEmail().withMessage('Valid email is required'),
  body('phone').isMobilePhone('en-IN').withMessage('Valid phone number is required'),
  body('dateOfBirth').isDate().withMessage('Valid date of birth is required'),
  body('gender').isIn(['male', 'female', 'other']).withMessage('Valid gender is required'),
  body('category').isIn(['general', 'obc', 'sc', 'st', 'ews']).withMessage('Valid category is required'),
  body('fatherName').notEmpty().withMessage('Father name is required'),
  body('motherName').notEmpty().withMessage('Mother name is required'),
];

const addressInfoValidation = [
  body('address').notEmpty().withMessage('Address is required'),
  body('countryId').isUUID().withMessage('Valid country is required'),
  body('stateId').isUUID().withMessage('Valid state is required'),
  body('cityId').isUUID().withMessage('Valid city is required'),
  body('pincode').isLength({ min: 6, max: 6 }).withMessage('Valid pincode is required'),
];

const academicInfoValidation = [
  body('collegeId').isUUID().withMessage('Valid college is required'),
  body('branchId').isUUID().withMessage('Valid branch is required'),
  body('tradeId').isUUID().withMessage('Valid trade is required'),
];

module.exports = {
  validateRequest,
  registerValidation,
  loginValidation,
  personalInfoValidation,
  addressInfoValidation,
  academicInfoValidation
};