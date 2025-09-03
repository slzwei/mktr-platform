import { jest } from '@jest/globals';
import { googleLogin } from '../controllers/authController.js';

// Mock dependencies
jest.mock('google-auth-library');
jest.mock('../models/index.js');
jest.mock('jsonwebtoken');

import { OAuth2Client } from 'google-auth-library';
import { User } from '../models/index.js';
import jwt from 'jsonwebtoken';

describe('Google OAuth Controller', () => {
  let req, res, mockTicket, mockPayload;

  beforeEach(() => {
    req = {
      body: {
        credential: 'mock-google-token'
      }
    };
    
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn()
    };

    mockPayload = {
      email: 'test@example.com',
      sub: 'google-sub-123',
      name: 'Test User',
      picture: 'https://example.com/avatar.jpg'
    };

    mockTicket = {
      getPayload: jest.fn().mockReturnValue(mockPayload)
    };

    // Reset mocks
    jest.clearAllMocks();
    
    // Set up environment variable
    process.env.GOOGLE_CLIENT_ID = 'mock-client-id';
    process.env.JWT_SECRET = 'mock-jwt-secret';
  });

  describe('Happy Path - New User', () => {
    it('should create new user and return token for valid Google credential', async () => {
      // Mock Google verification
      OAuth2Client.prototype.verifyIdToken = jest.fn().mockResolvedValue(mockTicket);
      
      // Mock user not found, then created
      User.findOne = jest.fn().mockResolvedValue(null);
      const mockUser = {
        id: 'user-123',
        email: 'test@example.com',
        role: 'customer',
        fullName: 'Test User',
        firstName: 'Test',
        lastName: 'User',
        avatarUrl: 'https://example.com/avatar.jpg',
        isActive: true,
        lastLogin: new Date(),
        save: jest.fn()
      };
      User.create = jest.fn().mockResolvedValue(mockUser);
      
      // Mock JWT
      jwt.sign = jest.fn().mockReturnValue('mock-jwt-token');

      await googleLogin(req, res);

      expect(OAuth2Client.prototype.verifyIdToken).toHaveBeenCalledWith({
        idToken: 'mock-google-token',
        audience: 'mock-client-id'
      });

      expect(User.create).toHaveBeenCalledWith({
        email: 'test@example.com',
        firstName: 'Test',
        lastName: 'User',
        fullName: 'Test User',
        avatarUrl: 'https://example.com/avatar.jpg',
        role: 'customer',
        isActive: true,
        googleSub: 'google-sub-123',
        lastLogin: expect.any(Date),
        emailVerified: true,
        password: null
      });

      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: 'Google authentication successful',
        data: {
          token: 'mock-jwt-token',
          user: {
            id: 'user-123',
            email: 'test@example.com',
            role: 'customer',
            full_name: 'Test User',
            firstName: 'Test',
            lastName: 'User',
            avatarUrl: 'https://example.com/avatar.jpg',
            isActive: true,
            lastLogin: expect.any(Date)
          }
        }
      });
    });
  });

  describe('Happy Path - Existing User', () => {
    it('should update existing user and return token', async () => {
      // Mock Google verification
      OAuth2Client.prototype.verifyIdToken = jest.fn().mockResolvedValue(mockTicket);
      
      // Mock existing user
      const mockUser = {
        id: 'user-123',
        email: 'test@example.com',
        role: 'customer',
        fullName: 'Test User',
        firstName: 'Test',
        lastName: 'User',
        avatarUrl: null,
        googleSub: null,
        isActive: true,
        lastLogin: null,
        save: jest.fn()
      };
      User.findOne = jest.fn().mockResolvedValue(mockUser);
      
      // Mock JWT
      jwt.sign = jest.fn().mockReturnValue('mock-jwt-token');

      await googleLogin(req, res);

      expect(mockUser.googleSub).toBe('google-sub-123');
      expect(mockUser.avatarUrl).toBe('https://example.com/avatar.jpg');
      expect(mockUser.save).toHaveBeenCalled();

      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: 'Google authentication successful',
        data: {
          token: 'mock-jwt-token',
          user: expect.objectContaining({
            id: 'user-123',
            email: 'test@example.com'
          })
        }
      });
    });
  });

  describe('Error Cases', () => {
    it('should return error for missing credential', async () => {
      req.body.credential = null;

      await googleLogin(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: 'Missing Google credential'
      });
    });

    it('should return error for invalid Google token', async () => {
      OAuth2Client.prototype.verifyIdToken = jest.fn().mockRejectedValue(
        new Error('Token used too late')
      );

      await googleLogin(req, res);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: 'Google token has expired. Please try again.'
      });
    });

    it('should return error for inactive user', async () => {
      OAuth2Client.prototype.verifyIdToken = jest.fn().mockResolvedValue(mockTicket);
      
      const mockUser = {
        isActive: false,
        save: jest.fn()
      };
      User.findOne = jest.fn().mockResolvedValue(mockUser);

      await googleLogin(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: 'User account is inactive'
      });
    });
  });
});
