# 🧪 MKTR Backend API Testing Guide

This guide provides multiple ways to test all the API endpoints in your MKTR backend system.

## 🚀 Quick Start

### 1. Start the Backend

```bash
# Option 1: Using Docker (Recommended)
./setup-backend.sh

# Option 2: Manual start
cd backend
npm install
docker-compose up -d postgres redis  # Start only database
npm run dev
```

### 2. Verify Backend is Running

```bash
curl http://localhost:3001/health
```

You should see: `{"status":"OK","timestamp":"...","uptime":...}`

## 🔧 Testing Methods

### Method 1: Automated Test Script (Easiest)

Run the comprehensive automated test:

```bash
cd backend
npm install node-fetch  # Install dependency if needed
node test-api.js
```

This will:

- ✅ Test all major endpoints
- 🔐 Handle authentication automatically
- 📊 Show detailed results
- 💾 Save test data for reference
- 🎯 Give you a success rate

**Sample Output:**

```
🚀 Starting MKTR Backend API Tests
Base URL: http://localhost:3001

🧪 Testing: Health Check
✅ Health check passed

🧪 Testing: Authentication
✅ Registered admin: admin@test.com
✅ Profile retrieval successful

📊 Test Results Summary
✅ Passed: 7
Success Rate: 100.0%
🎉 All tests passed! Your API is working correctly.
```

### Method 2: VS Code REST Client

1. **Install Extension**: Install "REST Client" extension in VS Code
2. **Open Test File**: Open `backend/test-endpoints.http`
3. **Run Tests**: Click "Send Request" above each endpoint

**Key Features:**

- 📝 Pre-written requests for all endpoints
- 🔗 Variable substitution (replace `{{authToken}}` with actual token)
- 📋 Copy/paste friendly
- 🎯 Organized by feature

### Method 3: Postman Collection

1. **Import Collection**: Import `backend/postman-collection.json` into Postman
2. **Set Variables**:
   - `baseUrl`: `http://localhost:3001/api`
   - `authToken`: (will be set automatically after login)
3. **Run Collection**: Execute requests in order

**Postman Features:**

- 🔄 Automatic token management
- 📊 Test scripts included
- 🏃‍♂️ Can run entire collection at once
- 📈 Built-in analytics

### Method 4: curl Commands

Basic curl examples for manual testing:

```bash
# Health Check
curl http://localhost:3001/health

# Register User
curl -X POST http://localhost:3001/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "password123",
    "firstName": "Test",
    "lastName": "User",
    "role": "admin"
  }'

# Login (save the token from response)
curl -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "password123"
  }'

# Use token for authenticated requests
TOKEN="your-jwt-token-here"
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:3001/api/auth/profile
```

## 📋 Complete Endpoint Checklist

### ✅ Authentication Endpoints

- [ ] `POST /auth/register` - Register new user
- [ ] `POST /auth/login` - User login
- [ ] `GET /auth/profile` - Get current user
- [ ] `PUT /auth/profile` - Update profile
- [ ] `PUT /auth/change-password` - Change password

### ✅ User Management

- [ ] `GET /users` - Get all users (Admin)
- [ ] `GET /users/:id` - Get user by ID
- [ ] `PUT /users/:id` - Update user
- [ ] `PATCH /users/:id/status` - Activate/deactivate user

### ✅ Campaign Management

- [ ] `GET /campaigns` - Get all campaigns
- [ ] `POST /campaigns` - Create campaign
- [ ] `GET /campaigns/:id` - Get campaign details
- [ ] `PUT /campaigns/:id` - Update campaign
- [ ] `GET /campaigns/:id/analytics` - Get campaign analytics
- [ ] `POST /campaigns/:id/duplicate` - Duplicate campaign

### ✅ QR Code System

- [ ] `GET /qrcodes` - Get all QR codes
- [ ] `POST /qrcodes` - Create QR code
- [ ] `GET /qrcodes/:id` - Get QR code details
- [ ] `PUT /qrcodes/:id` - Update QR code
- [ ] `GET /qrcodes/track/:shortUrl` - Track QR scan (public)
- [ ] `POST /qrcodes/:id/scan` - Record manual scan
- [ ] `GET /qrcodes/:id/analytics` - Get QR analytics

### ✅ Prospect Management

- [ ] `GET /prospects` - Get all prospects
- [ ] `POST /prospects` - Create prospect (lead capture)
- [ ] `GET /prospects/:id` - Get prospect details
- [ ] `PUT /prospects/:id` - Update prospect
- [ ] `PATCH /prospects/:id/assign` - Assign to agent
- [ ] `PATCH /prospects/bulk/assign` - Bulk assign prospects
- [ ] `GET /prospects/stats/overview` - Get prospect statistics

### ✅ Fleet Management

- [ ] `GET /fleet/owners` - Get fleet owners
- [ ] `POST /fleet/owners` - Create fleet owner profile
- [ ] `GET /fleet/cars` - Get all cars
- [ ] `POST /fleet/cars` - Add new car
- [ ] `PATCH /fleet/cars/:id/assign-driver` - Assign driver to car
- [ ] `GET /fleet/drivers` - Get all drivers
- [ ] `POST /fleet/drivers` - Add new driver
- [ ] `GET /fleet/stats/overview` - Get fleet statistics

### ✅ Commission System

- [ ] `GET /commissions` - Get all commissions
- [ ] `POST /commissions` - Create commission (Admin)
- [ ] `PATCH /commissions/:id/approve` - Approve commission
- [ ] `PATCH /commissions/:id/pay` - Mark as paid
- [ ] `PATCH /commissions/bulk/approve` - Bulk approve
- [ ] `GET /commissions/stats/overview` - Get commission stats

### ✅ Agent Management

- [ ] `GET /agents` - Get all agents (Admin)
- [ ] `GET /agents/:id` - Get agent details
- [ ] `GET /agents/:id/prospects` - Get agent's prospects
- [ ] `GET /agents/:id/commissions` - Get agent's commissions
- [ ] `GET /agents/leaderboard/performance` - Performance leaderboard

### ✅ File Uploads

- [ ] `POST /uploads/single` - Upload single file
- [ ] `POST /uploads/multiple` - Upload multiple files
- [ ] `POST /uploads/avatar` - Upload user avatar
- [ ] `POST /uploads/campaign-assets` - Upload campaign assets
- [ ] `POST /uploads/documents` - Upload documents

### ✅ Dashboard & Analytics

- [ ] `GET /dashboard/overview` - Get dashboard stats
- [ ] `GET /dashboard/analytics` - Get detailed analytics

## 🔐 Authentication Flow

1. **Register or Login** to get JWT token
2. **Copy the token** from the response
3. **Include in headers** for protected endpoints:
   ```
   Authorization: Bearer your-jwt-token-here
   ```

## 🎭 User Roles & Permissions

### Admin

- ✅ Full access to all endpoints
- ✅ Can manage users, approve commissions
- ✅ Can see all data across the system

### Agent

- ✅ Can manage their own campaigns and prospects
- ✅ Can view their commissions and performance
- ❌ Cannot access admin functions

### Fleet Owner

- ✅ Can manage their fleet (cars, drivers)
- ✅ Can view fleet-related QR codes and analytics
- ❌ Cannot access campaigns or commissions

### Customer

- ✅ Can submit leads (prospect creation)
- ❌ Limited access to other features

## 🧪 Test Scenarios

### Basic Flow Test

1. Register admin user
2. Login and get token
3. Create a campaign
4. Create QR code for campaign
5. Submit a lead (prospect)
6. Assign prospect to agent
7. Update prospect status to "won"
8. Check commission was created
9. View dashboard analytics

### Fleet Management Test

1. Register fleet owner
2. Create fleet owner profile
3. Add cars to fleet
4. Add drivers
5. Assign drivers to cars
6. Create QR codes for cars
7. Track QR scans

### Multi-User Test

1. Register admin, agent, and fleet owner
2. Admin creates campaign
3. Agent creates QR codes
4. Fleet owner adds cars with QR codes
5. Prospects submit leads via QR codes
6. Track conversion funnel

## 🐛 Troubleshooting

### Common Issues

**Backend not starting:**

```bash
# Check if port 3001 is in use
lsof -i :3001

# Check Docker containers
docker-compose ps

# View logs
docker-compose logs backend
```

**Database connection issues:**

```bash
# Check PostgreSQL is running
docker-compose ps postgres

# Connect to database directly
docker-compose exec postgres psql -U mktr_user -d mktr_db
```

**Authentication failures:**

- Make sure to include `Bearer ` prefix in Authorization header
- Check token hasn't expired (default: 7 days)
- Verify user account is active

**404 Errors:**

- Check base URL is correct: `http://localhost:3001/api`
- Verify endpoint path in documentation
- Make sure backend is running

### Debug Mode

Enable debug logging:

```bash
# In backend/.env
NODE_ENV=development

# Restart backend to see detailed logs
docker-compose restart backend
```

## 📊 Performance Testing

For load testing, use tools like:

- **Artillery**: `npm install -g artillery`
- **Apache Bench**: `ab -n 100 -c 10 http://localhost:3001/health`
- **Postman Runner**: Run collection multiple times

## 🚀 Production Testing

Before deploying:

1. **Run full test suite**: `node test-api.js`
2. **Check all endpoints**: Use the checklist above
3. **Test error scenarios**: Invalid data, unauthorized access
4. **Performance test**: Ensure API can handle expected load
5. **Security test**: Verify authentication and authorization work correctly

## 📝 Test Data Management

The automated test script saves test data to `test-results.json`:

```json
{
  "timestamp": "2024-01-01T00:00:00.000Z",
  "results": { "passed": 7, "failed": 0, "total": 7, "successRate": "100.0" },
  "testData": {
    "users": { "admin": {...}, "agent": {...} },
    "campaigns": { "test": {...} },
    "prospects": { "test": {...} }
  }
}
```

Use this data for:

- 🔄 Debugging failed tests
- 📋 Manual testing with real IDs
- 🧹 Cleanup after testing

---

## 🎉 Success!

If all tests pass, your backend is working correctly and ready for:

- 🔗 Frontend integration
- 🚀 Production deployment
- 📱 Mobile app development
- 🔌 Third-party integrations

Happy testing! 🚀
