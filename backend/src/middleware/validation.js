import Joi from 'joi';

// Validation middleware
export const validate = (schema) => {
  return (req, res, next) => {
    const { error } = schema.validate(req.body, { abortEarly: false });
    
    if (error) {
      const details = error.details.map(detail => ({
        field: detail.path.join('.'),
        message: detail.message
      }));
      
      return res.status(400).json({
        success: false,
        message: 'Validation Error',
        details: 'Invalid request data',
        errors: details
      });
    }
    
    next();
  };
};

// Common validation schemas
export const schemas = {
  // User schemas
  userRegister: Joi.object({
    email: Joi.string().email().required(),
    password: Joi.string().min(6).required(),
    firstName: Joi.string().min(1).max(50).required(),
    lastName: Joi.string().min(1).max(50).required(),
    phone: Joi.string().min(10).max(20).optional(),
    role: Joi.string().valid('admin', 'agent', 'fleet_owner', 'customer').optional()
  }),

  userLogin: Joi.object({
    email: Joi.string().email().required(),
    password: Joi.string().required()
  }),

  userUpdate: Joi.object({
    firstName: Joi.string().min(1).max(50).optional(),
    lastName: Joi.string().min(1).max(50).optional(),
    phone: Joi.string().min(10).max(20).optional(),
    avatar: Joi.string().optional()
  }),

  // Campaign schemas
  campaignCreate: Joi.object({
    name: Joi.string().min(1).max(100).required(),
    description: Joi.string().optional(),
    type: Joi.string().valid('lead_generation', 'brand_awareness', 'product_promotion', 'event_marketing').required(),
    budget: Joi.number().min(0).optional(),
    targetAudience: Joi.object().optional(),
    startDate: Joi.date().optional(),
    endDate: Joi.date().greater(Joi.ref('startDate')).optional(),
    landingPageUrl: Joi.string().uri().optional(),
    callToAction: Joi.string().max(200).optional(),
    tags: Joi.array().items(Joi.string()).optional()
  }),

  campaignUpdate: Joi.object({
    name: Joi.string().min(1).max(100).optional(),
    description: Joi.string().optional(),
    status: Joi.string().valid('draft', 'active', 'paused', 'completed', 'archived').optional(),
    budget: Joi.number().min(0).optional(),
    targetAudience: Joi.object().optional(),
    startDate: Joi.date().optional(),
    endDate: Joi.date().optional(),
    landingPageUrl: Joi.string().uri().optional(),
    callToAction: Joi.string().max(200).optional(),
    tags: Joi.array().items(Joi.string()).optional()
  }),

  // Car schemas
  carCreate: Joi.object({
    make: Joi.string().min(1).max(50).required(),
    model: Joi.string().min(1).max(50).required(),
    year: Joi.number().min(1900).max(new Date().getFullYear() + 1).required(),
    color: Joi.string().max(30).optional(),
    licensePlate: Joi.string().min(1).max(20).required(),
    vin: Joi.string().length(17).optional(),
    type: Joi.string().valid('sedan', 'suv', 'truck', 'van', 'coupe', 'hatchback', 'convertible', 'other').required(),
    location: Joi.object().optional(),
    features: Joi.array().items(Joi.string()).optional(),
    mileage: Joi.number().min(0).optional(),
    fuelType: Joi.string().valid('gasoline', 'diesel', 'electric', 'hybrid', 'other').optional()
  }),

  // Prospect schemas
  prospectCreate: Joi.object({
    firstName: Joi.string().min(1).max(50).required(),
    lastName: Joi.string().min(1).max(50).required(),
    email: Joi.string().email().required(),
    phone: Joi.string().min(10).max(20).optional(),
    company: Joi.string().max(100).optional(),
    jobTitle: Joi.string().max(100).optional(),
    industry: Joi.string().max(50).optional(),
    leadSource: Joi.string().valid('qr_code', 'website', 'referral', 'social_media', 'advertisement', 'direct', 'other').required(),
    interests: Joi.array().items(Joi.string()).optional(),
    budget: Joi.object().optional(),
    location: Joi.object().optional(),
    campaignId: Joi.string().uuid().optional(),
    qrTagId: Joi.string().uuid().optional()
  }),

  // QR Tag schemas
  qrTagCreate: Joi.object({
    name: Joi.string().min(1).max(100).required(),
    description: Joi.string().optional(),
    type: Joi.string().valid('campaign', 'car', 'promotional', 'event', 'location', 'other').required(),
    destinationUrl: Joi.string().uri().required(),
    location: Joi.object().optional(),
    placement: Joi.object().optional(),
    expirationDate: Joi.date().optional(),
    maxScans: Joi.number().min(1).optional(),
    tags: Joi.array().items(Joi.string()).optional(),
    campaignId: Joi.string().uuid().optional(),
    carId: Joi.string().uuid().optional()
  }),

  // Fleet Owner schemas
  fleetOwnerCreate: Joi.object({
    companyName: Joi.string().min(1).max(100).required(),
    businessType: Joi.string().valid('transportation', 'delivery', 'rideshare', 'logistics', 'rental', 'other').required(),
    businessLicense: Joi.string().max(50).optional(),
    taxId: Joi.string().max(20).optional(),
    address: Joi.object().optional(),
    contactInfo: Joi.object().optional(),
    bankingInfo: Joi.object().optional(),
    insurance: Joi.object().optional()
  }),

  // Driver schemas
  driverCreate: Joi.object({
    licenseNumber: Joi.string().min(1).max(30).required(),
    licenseClass: Joi.string().min(1).max(10).required(),
    licenseExpiration: Joi.date().required(),
    dateOfBirth: Joi.date().required(),
    address: Joi.object().optional(),
    emergencyContact: Joi.object().optional(),
    experience: Joi.number().min(0).max(50).optional(),
    certifications: Joi.array().items(Joi.string()).optional()
  }),

  // Lead Package schemas
  leadPackageCreate: Joi.object({
    name: Joi.string().min(1).max(100).required(),
    description: Joi.string().optional(),
    type: Joi.string().valid('basic', 'premium', 'enterprise', 'custom').required(),
    category: Joi.string().max(50).optional(),
    price: Joi.number().min(0).required(),
    leadCount: Joi.number().min(1).required(),
    qualityScore: Joi.number().min(1).max(10).optional(),
    targetAudience: Joi.object().optional(),
    leadCriteria: Joi.object().optional(),
    deliveryMethod: Joi.string().valid('email', 'api', 'csv_download', 'dashboard').optional(),
    validityPeriod: Joi.number().min(1).optional(),
    features: Joi.array().items(Joi.string()).optional(),
    tags: Joi.array().items(Joi.string()).optional(),
    campaignId: Joi.string().uuid().optional()
  })
};
