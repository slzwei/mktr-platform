import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import QRCode from 'qrcode';

const app = express();
const PORT = 3001;

// Mock database
const mockDB = {
  users: new Map(),
  campaigns: new Map(),
  prospects: new Map(),
  qrTags: new Map(),
  commissions: new Map(),
  cars: new Map(),
  drivers: new Map(),
  fleetOwners: new Map(),
  leadPackages: new Map()
};

// Mock JWT token
const MOCK_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.mock.token';

// Middleware
app.use(cors({ origin: '*', credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Mock auth middleware
const authenticateToken = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token || token !== MOCK_TOKEN) {
    return res.status(401).json({ success: false, message: 'Access token required' });
  }
  req.user = { id: 'admin-user-id', role: 'admin', email: 'admin@test.com' };
  next();
};

// File upload setup
const upload = multer({ dest: 'uploads/' });

// ===== HEALTH CHECK =====
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: 'test'
  });
});

// ===== AUTHENTICATION ENDPOINTS =====
app.post('/api/auth/register', (req, res) => {
  const { email, password, firstName, lastName, role = 'customer' } = req.body;
  
  if (mockDB.users.has(email)) {
    return res.status(400).json({ success: false, message: 'User already exists' });
  }

  const user = {
    id: uuidv4(),
    email,
    firstName,
    lastName,
    role,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date()
  };

  mockDB.users.set(email, user);

  res.status(201).json({
    success: true,
    message: 'User registered successfully',
    data: { user, token: MOCK_TOKEN }
  });
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  const user = mockDB.users.get(email);

  if (!user) {
    return res.status(401).json({ success: false, message: 'Invalid credentials' });
  }

  res.json({
    success: true,
    message: 'Login successful',
    data: { user, token: MOCK_TOKEN }
  });
});

app.get('/api/auth/profile', authenticateToken, (req, res) => {
  res.json({
    success: true,
    data: { user: req.user }
  });
});

app.put('/api/auth/profile', authenticateToken, (req, res) => {
  res.json({
    success: true,
    message: 'Profile updated successfully',
    data: { user: { ...req.user, ...req.body } }
  });
});

app.put('/api/auth/change-password', authenticateToken, (req, res) => {
  res.json({
    success: true,
    message: 'Password changed successfully'
  });
});

app.post('/api/auth/google', async (req, res) => {
  const { idToken, credential } = req.body;
  
  // Support both old idToken and new credential format
  const token = credential || idToken;
  
  if (!token) {
    return res.status(400).json({ 
      success: false, 
      message: 'Google credential is required' 
    });
  }

  try {
    // In production, you would verify the token with Google:
    // const ticket = await client.verifyIdToken({
    //   idToken: token,
    //   audience: 'your-google-client-id'
    // });
    // const payload = ticket.getPayload();
    
    // For now, we'll decode the JWT token to extract user info
    // This is a simplified version - in production use proper Google verification
    console.log('Google OAuth token received:', token);
    
    let userEmail = 'user@gmail.com';
    let userName = 'Google User';
    
    // Try to decode the JWT token if it's real (not our test token)
    if (token.startsWith('eyJ')) {
      try {
        // Simple JWT decode (without verification for demo)
        const payload = JSON.parse(atob(token.split('.')[1]));
        userEmail = payload.email || userEmail;
        userName = payload.name || payload.given_name + ' ' + payload.family_name || userName;
        console.log('Decoded Google user:', { email: userEmail, name: userName });
      } catch (decodeError) {
        console.log('Could not decode token, using defaults');
      }
    }
    
    // Determine role based on specific email addresses or patterns
    let userRole = 'customer';
    
    // Specific email-based role assignments
    console.log('🔍 ROLE ASSIGNMENT: Checking email:', userEmail);
    if (userEmail === 'shawnleeapps@gmail.com') {
      userRole = 'admin'; // Give you admin access
      console.log('✅ ROLE ASSIGNMENT: Assigned admin role to shawnleeapps@gmail.com');
    } else if (userEmail.includes('admin')) {
      userRole = 'admin';
    } else if (userEmail.includes('agent')) {
      userRole = 'agent';
    } else if (userEmail.includes('fleet')) {
      userRole = 'fleet_owner';
    }
    // Otherwise stays 'customer'
    
    const authenticatedUser = {
      id: 'google-' + Buffer.from(userEmail).toString('base64').slice(0, 8),
      email: userEmail,
      full_name: userName,
      role: userRole,
      provider: 'google',
      created_at: new Date().toISOString()
    };

    const jwtToken = 'google-jwt-token-' + Date.now();

    res.json({
      success: true,
      message: 'Google authentication successful',
      data: {
        token: jwtToken,
        user: authenticatedUser
      }
    });
  } catch (error) {
    console.error('Google OAuth error:', error);
    res.status(500).json({
      success: false,
      message: 'Google authentication failed'
    });
  }
});

// ===== USER MANAGEMENT =====
app.get('/api/users', authenticateToken, (req, res) => {
  const users = Array.from(mockDB.users.values());
  res.json({
    success: true,
    data: {
      users,
      pagination: { currentPage: 1, totalPages: 1, totalItems: users.length, itemsPerPage: 10 }
    }
  });
});

app.get('/api/users/:id', authenticateToken, (req, res) => {
  const user = Array.from(mockDB.users.values()).find(u => u.id === req.params.id);
  if (!user) {
    return res.status(404).json({ success: false, message: 'User not found' });
  }
  res.json({ success: true, data: { user } });
});

app.get('/api/users/agents/list', authenticateToken, (req, res) => {
  const agents = Array.from(mockDB.users.values()).filter(u => u.role === 'agent');
  res.json({
    success: true,
    data: { agents }
  });
});

app.put('/api/users/:id', authenticateToken, (req, res) => {
  res.json({
    success: true,
    message: 'User updated successfully',
    data: { user: { id: req.params.id, ...req.body } }
  });
});

// ===== CAMPAIGN MANAGEMENT =====
app.get('/api/campaigns', authenticateToken, (req, res) => {
  const campaigns = Array.from(mockDB.campaigns.values());
  res.json({
    success: true,
    data: {
      campaigns,
      pagination: { currentPage: 1, totalPages: 1, totalItems: campaigns.length, itemsPerPage: 10 }
    }
  });
});

app.post('/api/campaigns', authenticateToken, (req, res) => {
  const campaign = {
    id: uuidv4(),
    ...req.body,
    createdBy: req.user.id,
    status: 'draft',
    metrics: { views: 0, clicks: 0, conversions: 0, leads: 0, revenue: 0 },
    createdAt: new Date(),
    updatedAt: new Date()
  };

  mockDB.campaigns.set(campaign.id, campaign);

  res.status(201).json({
    success: true,
    message: 'Campaign created successfully',
    data: { campaign }
  });
});

app.get('/api/campaigns/:id', authenticateToken, (req, res) => {
  const campaign = mockDB.campaigns.get(req.params.id);
  if (!campaign) {
    return res.status(404).json({ success: false, message: 'Campaign not found' });
  }
  res.json({ success: true, data: { campaign } });
});

app.put('/api/campaigns/:id', authenticateToken, (req, res) => {
  const campaign = mockDB.campaigns.get(req.params.id);
  if (!campaign) {
    return res.status(404).json({ success: false, message: 'Campaign not found' });
  }

  const updated = { ...campaign, ...req.body, updatedAt: new Date() };
  mockDB.campaigns.set(req.params.id, updated);

  res.json({
    success: true,
    message: 'Campaign updated successfully',
    data: { campaign: updated }
  });
});

app.get('/api/campaigns/:id/analytics', authenticateToken, (req, res) => {
  const campaign = mockDB.campaigns.get(req.params.id);
  if (!campaign) {
    return res.status(404).json({ success: false, message: 'Campaign not found' });
  }

  res.json({
    success: true,
    data: {
      analytics: {
        campaign: { metrics: campaign.metrics, totalQrTags: 2, totalScans: 150 },
        prospects: { total: 25, qualified: 10, converted: 3, conversionRate: 12.0 },
        qrTags: [{ id: '1', name: 'QR1', scanCount: 100, conversionRate: 8.0 }]
      }
    }
  });
});

app.post('/api/campaigns/:id/duplicate', authenticateToken, (req, res) => {
  const campaign = mockDB.campaigns.get(req.params.id);
  if (!campaign) {
    return res.status(404).json({ success: false, message: 'Campaign not found' });
  }

  const duplicated = {
    ...campaign,
    id: uuidv4(),
    name: req.body.name || `${campaign.name} (Copy)`,
    status: 'draft',
    createdAt: new Date(),
    updatedAt: new Date()
  };

  mockDB.campaigns.set(duplicated.id, duplicated);

  res.status(201).json({
    success: true,
    message: 'Campaign duplicated successfully',
    data: { campaign: duplicated }
  });
});

// ===== QR CODE MANAGEMENT =====
app.get('/api/qrcodes', authenticateToken, (req, res) => {
  const qrTags = Array.from(mockDB.qrTags.values());
  res.json({
    success: true,
    data: {
      qrTags,
      pagination: { currentPage: 1, totalPages: 1, totalItems: qrTags.length, itemsPerPage: 10 }
    }
  });
});

app.post('/api/qrcodes', authenticateToken, async (req, res) => {
  const { destinationUrl, name, description, type } = req.body;
  
  try {
    const shortUrl = `https://mktr.ly/${Math.random().toString(36).substring(7)}`;
    const trackingUrl = `http://localhost:3001/api/qrcodes/track/${shortUrl.split('/').pop()}`;
    const qrCode = await QRCode.toString(trackingUrl, { type: 'svg' });

    const qrTag = {
      id: uuidv4(),
      name,
      description,
      type,
      qrCode,
      qrData: trackingUrl,
      shortUrl,
      destinationUrl,
      status: 'active',
      scanCount: 0,
      createdBy: req.user.id,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    mockDB.qrTags.set(qrTag.id, qrTag);

    res.status(201).json({
      success: true,
      message: 'QR code created successfully',
      data: { qrTag }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to generate QR code',
      error: error.message
    });
  }
});

app.get('/api/qrcodes/:id', authenticateToken, (req, res) => {
  const qrTag = mockDB.qrTags.get(req.params.id);
  if (!qrTag) {
    return res.status(404).json({ success: false, message: 'QR code not found' });
  }
  res.json({ success: true, data: { qrTag } });
});

app.post('/api/qrcodes/:id/scan', authenticateToken, (req, res) => {
  const qrTag = mockDB.qrTags.get(req.params.id);
  if (!qrTag) {
    return res.status(404).json({ success: false, message: 'QR code not found' });
  }

  qrTag.scanCount += 1;
  qrTag.lastScanned = new Date();
  mockDB.qrTags.set(req.params.id, qrTag);

  res.json({
    success: true,
    message: 'Scan recorded successfully',
    data: { scanCount: qrTag.scanCount, destinationUrl: qrTag.destinationUrl }
  });
});

app.put('/api/qrcodes/:id', authenticateToken, (req, res) => {
  const qrTag = mockDB.qrTags.get(req.params.id);
  if (!qrTag) {
    return res.status(404).json({ success: false, message: 'QR code not found' });
  }

  const updated = { ...qrTag, ...req.body, updatedAt: new Date() };
  mockDB.qrTags.set(req.params.id, updated);

  res.json({
    success: true,
    message: 'QR code updated successfully',
    data: { qrTag: updated }
  });
});

app.get('/api/qrcodes/:id/analytics', authenticateToken, (req, res) => {
  const qrTag = mockDB.qrTags.get(req.params.id);
  if (!qrTag) {
    return res.status(404).json({ success: false, message: 'QR code not found' });
  }

  res.json({
    success: true,
    data: {
      analytics: {
        qrTag: { id: qrTag.id, name: qrTag.name, type: qrTag.type },
        summary: { totalScans: qrTag.scanCount, uniqueScans: qrTag.scanCount - 10 },
        periodData: [{ date: '2024-01-01', scans: 25 }],
        deviceTypes: { mobile: 60, desktop: 40 }
      }
    }
  });
});

app.post('/api/qrcodes/bulk', authenticateToken, (req, res) => {
  const { operation, qrTagIds } = req.body;
  
  res.json({
    success: true,
    message: `${qrTagIds.length} QR codes ${operation}d successfully`,
    data: { affectedCount: qrTagIds.length }
  });
});

// ===== PROSPECT MANAGEMENT =====
app.get('/api/prospects', authenticateToken, (req, res) => {
  const prospects = Array.from(mockDB.prospects.values());
  res.json({
    success: true,
    data: {
      prospects,
      pagination: { currentPage: 1, totalPages: 1, totalItems: prospects.length, itemsPerPage: 10 }
    }
  });
});

app.post('/api/prospects', (req, res) => {
  const prospect = {
    id: uuidv4(),
    ...req.body,
    leadStatus: 'new',
    priority: 'medium',
    createdAt: new Date(),
    updatedAt: new Date()
  };

  mockDB.prospects.set(prospect.id, prospect);

  res.status(201).json({
    success: true,
    message: 'Prospect created successfully',
    data: { prospect }
  });
});

app.get('/api/prospects/:id', authenticateToken, (req, res) => {
  const prospect = mockDB.prospects.get(req.params.id);
  if (!prospect) {
    return res.status(404).json({ success: false, message: 'Prospect not found' });
  }
  res.json({ success: true, data: { prospect } });
});

app.put('/api/prospects/:id', authenticateToken, (req, res) => {
  const prospect = mockDB.prospects.get(req.params.id);
  if (!prospect) {
    return res.status(404).json({ success: false, message: 'Prospect not found' });
  }

  const updated = { ...prospect, ...req.body, updatedAt: new Date() };
  mockDB.prospects.set(req.params.id, updated);

  res.json({
    success: true,
    message: 'Prospect updated successfully',
    data: { prospect: updated }
  });
});

app.patch('/api/prospects/:id/assign', authenticateToken, (req, res) => {
  const prospect = mockDB.prospects.get(req.params.id);
  if (!prospect) {
    return res.status(404).json({ success: false, message: 'Prospect not found' });
  }

  const updated = { ...prospect, assignedAgentId: req.body.agentId, updatedAt: new Date() };
  mockDB.prospects.set(req.params.id, updated);

  res.json({
    success: true,
    message: 'Prospect assigned successfully',
    data: { prospect: updated }
  });
});

app.patch('/api/prospects/bulk/assign', authenticateToken, (req, res) => {
  const { prospectIds, agentId } = req.body;
  
  if (!prospectIds || !Array.isArray(prospectIds) || !agentId) {
    return res.status(400).json({ success: false, message: 'Invalid request data' });
  }
  
  // For mock server, we'll accept any IDs and return success
  res.json({
    success: true,
    message: `${prospectIds.length} prospects assigned successfully`,
    data: { affectedCount: prospectIds.length }
  });
});

app.get('/api/prospects/stats/overview', authenticateToken, (req, res) => {
  const prospects = Array.from(mockDB.prospects.values());
  
  res.json({
    success: true,
    data: {
      totalProspects: prospects.length,
      conversionRate: 15.5,
      byStatus: [
        { status: 'new', count: 45 },
        { status: 'qualified', count: 20 },
        { status: 'won', count: 8 }
      ],
      bySource: [
        { source: 'qr_code', count: 30 },
        { source: 'website', count: 25 }
      ]
    }
  });
});

// ===== COMMISSION MANAGEMENT =====
app.get('/api/commissions', authenticateToken, (req, res) => {
  const commissions = Array.from(mockDB.commissions.values());
  res.json({
    success: true,
    data: {
      commissions,
      pagination: { currentPage: 1, totalPages: 1, totalItems: commissions.length, itemsPerPage: 10 }
    }
  });
});

app.post('/api/commissions', authenticateToken, (req, res) => {
  const commission = {
    id: uuidv4(),
    ...req.body,
    status: 'pending',
    earnedDate: new Date(),
    createdAt: new Date(),
    updatedAt: new Date()
  };

  mockDB.commissions.set(commission.id, commission);

  res.status(201).json({
    success: true,
    message: 'Commission created successfully',
    data: { commission }
  });
});

app.patch('/api/commissions/:id/approve', authenticateToken, (req, res) => {
  const commission = mockDB.commissions.get(req.params.id);
  if (!commission) {
    return res.status(404).json({ success: false, message: 'Commission not found' });
  }

  const updated = { ...commission, status: 'approved', approvedBy: req.user.id, updatedAt: new Date() };
  mockDB.commissions.set(req.params.id, updated);

  res.json({
    success: true,
    message: 'Commission approved successfully',
    data: { commission: updated }
  });
});

app.get('/api/commissions/:id', authenticateToken, (req, res) => {
  const commission = mockDB.commissions.get(req.params.id);
  if (!commission) {
    return res.status(404).json({ success: false, message: 'Commission not found' });
  }
  res.json({ success: true, data: { commission } });
});

app.patch('/api/commissions/:id/pay', authenticateToken, (req, res) => {
  const commission = mockDB.commissions.get(req.params.id);
  if (!commission) {
    return res.status(404).json({ success: false, message: 'Commission not found' });
  }

  const updated = { ...commission, status: 'paid', paidDate: new Date(), updatedAt: new Date() };
  mockDB.commissions.set(req.params.id, updated);

  res.json({
    success: true,
    message: 'Commission marked as paid successfully',
    data: { commission: updated }
  });
});

app.get('/api/commissions/stats/overview', authenticateToken, (req, res) => {
  const commissions = Array.from(mockDB.commissions.values());
  
  res.json({
    success: true,
    data: {
      summary: { totalAmount: 15000, totalCount: commissions.length },
      byStatus: [
        { status: 'pending', count: 5, total: 2500 },
        { status: 'paid', count: 10, total: 12500 }
      ]
    }
  });
});

// ===== FLEET MANAGEMENT =====
app.get('/api/fleet/owners', authenticateToken, (req, res) => {
  const fleetOwners = Array.from(mockDB.fleetOwners.values());
  res.json({
    success: true,
    data: {
      fleetOwners,
      pagination: { currentPage: 1, totalPages: 1, totalItems: fleetOwners.length, itemsPerPage: 10 }
    }
  });
});

app.post('/api/fleet/owners', authenticateToken, (req, res) => {
  const fleetOwner = {
    id: uuidv4(),
    ...req.body,
    userId: req.user.id,
    status: 'active',
    createdAt: new Date(),
    updatedAt: new Date()
  };

  mockDB.fleetOwners.set(fleetOwner.id, fleetOwner);

  res.status(201).json({
    success: true,
    message: 'Fleet owner profile created successfully',
    data: { fleetOwner }
  });
});

app.get('/api/fleet/cars', authenticateToken, (req, res) => {
  const cars = Array.from(mockDB.cars.values());
  res.json({
    success: true,
    data: {
      cars,
      pagination: { currentPage: 1, totalPages: 1, totalItems: cars.length, itemsPerPage: 10 }
    }
  });
});

app.post('/api/fleet/cars', authenticateToken, (req, res) => {
  const car = {
    id: uuidv4(),
    ...req.body,
    status: 'active',
    createdAt: new Date(),
    updatedAt: new Date()
  };

  mockDB.cars.set(car.id, car);

  res.status(201).json({
    success: true,
    message: 'Car created successfully',
    data: { car }
  });
});

app.get('/api/fleet/cars/:id', authenticateToken, (req, res) => {
  const car = mockDB.cars.get(req.params.id);
  if (!car) {
    return res.status(404).json({ success: false, message: 'Car not found' });
  }
  res.json({ success: true, data: { car } });
});

app.put('/api/fleet/cars/:id', authenticateToken, (req, res) => {
  const car = mockDB.cars.get(req.params.id);
  if (!car) {
    return res.status(404).json({ success: false, message: 'Car not found' });
  }

  const updated = { ...car, ...req.body, updatedAt: new Date() };
  mockDB.cars.set(req.params.id, updated);

  res.json({
    success: true,
    message: 'Car updated successfully',
    data: { car: updated }
  });
});

app.get('/api/fleet/drivers', authenticateToken, (req, res) => {
  const drivers = Array.from(mockDB.drivers.values());
  res.json({
    success: true,
    data: {
      drivers,
      pagination: { currentPage: 1, totalPages: 1, totalItems: drivers.length, itemsPerPage: 10 }
    }
  });
});

app.get('/api/fleet/stats/overview', authenticateToken, (req, res) => {
  const cars = Array.from(mockDB.cars.values());
  const drivers = Array.from(mockDB.drivers.values());
  
  res.json({
    success: true,
    data: {
      totalCars: cars.length,
      activeCars: cars.filter(c => c.status === 'active').length,
      totalDrivers: drivers.length,
      activeDrivers: drivers.filter(d => d.status === 'active').length,
      utilizationRate: 85.5
    }
  });
});

// ===== AGENT MANAGEMENT =====
app.get('/api/agents', authenticateToken, (req, res) => {
  const agents = Array.from(mockDB.users.values()).filter(u => u.role === 'agent');
  res.json({
    success: true,
    data: {
      agents: agents.map(agent => ({ ...agent, stats: { totalProspects: 10, conversionRate: 15.5 } })),
      pagination: { currentPage: 1, totalPages: 1, totalItems: agents.length, itemsPerPage: 10 }
    }
  });
});

app.get('/api/agents/:id', authenticateToken, (req, res) => {
  const agent = Array.from(mockDB.users.values()).find(u => u.id === req.params.id);
  if (!agent) {
    return res.status(404).json({ success: false, message: 'Agent not found' });
  }
  res.json({
    success: true,
    data: {
      agent: {
        ...agent,
        stats: {
          prospects: { total: 25, converted: 5, conversionRate: 20.0 },
          commissions: { total: 1250.00, paid: 1000.00 }
        }
      }
    }
  });
});

app.get('/api/agents/:id/prospects', authenticateToken, (req, res) => {
  const prospects = Array.from(mockDB.prospects.values()).filter(p => p.assignedAgentId === req.params.id);
  res.json({
    success: true,
    data: {
      prospects,
      pagination: { currentPage: 1, totalPages: 1, totalItems: prospects.length, itemsPerPage: 10 }
    }
  });
});

app.get('/api/agents/:id/commissions', authenticateToken, (req, res) => {
  const commissions = Array.from(mockDB.commissions.values()).filter(c => c.agentId === req.params.id);
  res.json({
    success: true,
    data: {
      commissions,
      summary: { totalAmount: 1250.00, paidAmount: 1000.00 },
      pagination: { currentPage: 1, totalPages: 1, totalItems: commissions.length, itemsPerPage: 10 }
    }
  });
});

app.get('/api/agents/:id/campaigns', authenticateToken, (req, res) => {
  const campaigns = Array.from(mockDB.campaigns.values()).filter(c => c.createdBy === req.params.id);
  res.json({
    success: true,
    data: {
      campaigns: campaigns.map(c => ({ ...c, stats: { totalProspects: 10, conversionRate: 15.0 } })),
      pagination: { currentPage: 1, totalPages: 1, totalItems: campaigns.length, itemsPerPage: 10 }
    }
  });
});

app.get('/api/agents/leaderboard/performance', authenticateToken, (req, res) => {
  const agents = Array.from(mockDB.users.values()).filter(u => u.role === 'agent');
  res.json({
    success: true,
    data: {
      period: req.query.period || 'month',
      metric: req.query.metric || 'commissions',
      leaderboard: agents.map((agent, index) => ({
        rank: index + 1,
        agent,
        value: 1000 - (index * 100),
        metric: 'Total Commissions'
      }))
    }
  });
});

// ===== FILE UPLOADS =====
app.post('/api/uploads/single', authenticateToken, upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, message: 'No file uploaded' });
  }

  res.json({
    success: true,
    message: 'File uploaded successfully',
    data: {
      file: {
        id: uuidv4(),
        originalName: req.file.originalname,
        filename: req.file.filename,
        size: req.file.size,
        url: `/uploads/${req.file.filename}`
      }
    }
  });
});

app.post('/api/uploads/avatar', authenticateToken, upload.single('avatar'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, message: 'No avatar uploaded' });
  }

  res.json({
    success: true,
    message: 'Avatar uploaded successfully',
    data: {
      avatar: {
        url: `/uploads/${req.file.filename}`,
        filename: req.file.filename,
        size: req.file.size
      }
    }
  });
});

// ===== DASHBOARD =====
app.get('/api/dashboard/overview', authenticateToken, (req, res) => {
  res.json({
    success: true,
    data: {
      period: req.query.period || '30d',
      stats: {
        users: { total: 100, active: 85 },
        campaigns: { total: 15, active: 8 },
        prospects: { total: 250, new: 45 },
        commissions: { total: 15000, pending: 2500 }
      }
    }
  });
});

app.get('/api/dashboard/analytics', authenticateToken, (req, res) => {
  res.json({
    success: true,
    data: {
      type: req.query.type || 'prospects',
      period: req.query.period || '30d',
      analytics: {
        prospectsByStatus: [
          { status: 'new', count: 45 },
          { status: 'qualified', count: 20 },
          { status: 'won', count: 8 }
        ]
      }
    }
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Comprehensive Test Server running on port ${PORT}`);
  console.log(`📊 Health Check: http://localhost:${PORT}/health`);
  console.log(`🔗 API URL: http://localhost:${PORT}/api`);
  console.log(`\n✅ All endpoints ready for testing!`);
  console.log(`🔑 Mock Token: ${MOCK_TOKEN}`);
});
