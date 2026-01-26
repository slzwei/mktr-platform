import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { Sequelize } from 'sequelize';
import path from 'path';
import { fileURLToPath } from 'url';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Use SQLite for testing (anchor to backend directory to avoid stray DBs)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendRootDir = path.resolve(__dirname, './');
const testDbPath = path.join(backendRootDir, 'test.db');
const sequelize = new Sequelize({
  dialect: 'sqlite',
  storage: testDbPath,
  logging: false
});

// Basic middleware
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  credentials: true
}));

app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: 'test'
  });
});

// Simple test endpoints
app.post('/api/auth/register', (req, res) => {
  res.status(201).json({
    success: true,
    message: 'User registered successfully',
    data: {
      user: {
        id: '123e4567-e89b-12d3-a456-426614174000',
        email: req.body.email,
        firstName: req.body.firstName,
        lastName: req.body.lastName,
        role: req.body.role || 'customer'
      },
      token: 'test-jwt-token-123456789'
    }
  });
});

app.post('/api/auth/login', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Login successful',
    data: {
      user: {
        id: '123e4567-e89b-12d3-a456-426614174000',
        email: req.body.email,
        firstName: 'Test',
        lastName: 'User',
        role: 'admin'
      },
      token: 'test-jwt-token-123456789'
    }
  });
});

app.get('/api/auth/profile', (req, res) => {
  res.json({
    success: true,
    data: {
      user: {
        id: '123e4567-e89b-12d3-a456-426614174000',
        email: 'test@example.com',
        firstName: 'Test',
        lastName: 'User',
        role: 'admin'
      }
    }
  });
});

app.get('/api/campaigns', (req, res) => {
  res.json({
    success: true,
    data: {
      campaigns: [],
      pagination: {
        currentPage: 1,
        totalPages: 0,
        totalItems: 0,
        itemsPerPage: 10
      }
    }
  });
});

app.post('/api/campaigns', (req, res) => {
  res.status(201).json({
    success: true,
    message: 'Campaign created successfully',
    data: {
      campaign: {
        id: '456e7890-e89b-12d3-a456-426614174000',
        ...req.body,
        createdAt: new Date(),
        updatedAt: new Date()
      }
    }
  });
});

// Catch all for API endpoints
app.use('/api/*', (req, res) => {
  res.status(200).json({
    success: true,
    message: `Test endpoint: ${req.method} ${req.path}`,
    data: { endpoint: req.path, method: req.method }
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Test server running on port ${PORT}`);
  console.log(`📊 Health Check: http://localhost:${PORT}/health`);
  console.log(`🔗 API URL: http://localhost:${PORT}/api`);
  console.log(`\n✅ Ready for testing!`);
});
