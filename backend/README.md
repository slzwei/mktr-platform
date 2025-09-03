# MKTR Backend API

A comprehensive marketing platform backend built with Node.js, Express, and PostgreSQL.

## Features

- 🔐 **JWT Authentication** with role-based access control
- 👥 **Multi-role System**: Admin, Agent, Fleet Owner, Customer
- 📊 **Campaign Management** with analytics
- 🚗 **Fleet Management** for vehicle tracking
- 📱 **QR Code Generation** and tracking
- 👤 **Lead/Prospect Management**
- 💰 **Commission Tracking** system
- 📁 **File Upload** handling
- 📈 **Dashboard Analytics**
- 🐳 **Docker** containerization
- 🚀 **CI/CD** with GitHub Actions

## Quick Start

### Using Docker (Recommended)

1. **Clone the repository**

```bash
git clone <repository-url>
cd mktr/backend
```

2. **Environment Setup**

```bash
cp env.example .env
# Edit .env with your configuration
```

3. **Start with Docker**

```bash
docker-compose up
```

The API will be available at `http://localhost:3001`

### Manual Setup

1. **Prerequisites**

   - Node.js 18+
   - PostgreSQL 15+
   - Redis (optional, for caching)

2. **Install Dependencies**

```bash
npm install
```

3. **Database Setup**

```bash
# Create PostgreSQL database
createdb mktr_db

# Run migrations (Sequelize auto-sync in development)
npm run migrate
```

4. **Start Development Server**

```bash
npm run dev
```

## API Documentation

### Base URL

```
http://localhost:3001/api
```

### Authentication

All protected routes require a Bearer token:

```
Authorization: Bearer <jwt-token>
```

### Main Endpoints

#### Authentication

- `POST /auth/register` - Register new user
- `POST /auth/login` - User login
- `GET /auth/profile` - Get current user profile
- `PUT /auth/profile` - Update user profile
- `PUT /auth/change-password` - Change password

#### Users

- `GET /users` - Get all users (Admin only)
- `GET /users/:id` - Get user by ID
- `PUT /users/:id` - Update user
- `DELETE /users/:id` - Delete user (Admin only)

#### Campaigns

- `GET /campaigns` - Get all campaigns
- `POST /campaigns` - Create new campaign
- `GET /campaigns/:id` - Get campaign by ID
- `PUT /campaigns/:id` - Update campaign
- `DELETE /campaigns/:id` - Delete campaign
- `GET /campaigns/:id/analytics` - Get campaign analytics

#### QR Codes

- `GET /qrcodes` - Get all QR codes
- `POST /qrcodes` - Create new QR code
- `GET /qrcodes/:id` - Get QR code by ID
- `PUT /qrcodes/:id` - Update QR code
- `GET /qrcodes/track/:shortUrl` - Track QR code scan
- `POST /qrcodes/:id/scan` - Record QR scan

#### Prospects

- `GET /prospects` - Get all prospects
- `POST /prospects` - Create new prospect (lead capture)
- `GET /prospects/:id` - Get prospect by ID
- `PUT /prospects/:id` - Update prospect
- `PATCH /prospects/:id/assign` - Assign prospect to agent

#### Fleet Management

- `GET /fleet/owners` - Get fleet owners
- `POST /fleet/owners` - Create fleet owner profile
- `GET /fleet/cars` - Get all cars
- `POST /fleet/cars` - Add new car
- `GET /fleet/drivers` - Get all drivers
- `POST /fleet/drivers` - Add new driver

#### Commissions

- `GET /commissions` - Get all commissions
- `POST /commissions` - Create commission (Admin only)
- `PATCH /commissions/:id/approve` - Approve commission
- `PATCH /commissions/:id/pay` - Mark as paid

#### File Uploads

- `POST /uploads/single` - Upload single file
- `POST /uploads/multiple` - Upload multiple files
- `POST /uploads/avatar` - Upload user avatar
- `POST /uploads/campaign-assets` - Upload campaign assets

#### Dashboard

- `GET /dashboard/overview` - Get dashboard statistics
- `GET /dashboard/analytics` - Get analytics data

## Database Schema

### Core Entities

- **Users** - System users with roles
- **Campaigns** - Marketing campaigns
- **Prospects** - Leads and potential customers
- **QrTags** - QR codes with tracking
- **Commissions** - Agent earnings
- **Cars** - Fleet vehicles
- **Drivers** - Vehicle drivers
- **FleetOwners** - Fleet management entities
- **LeadPackages** - Packaged lead offerings

### Relationships

- Users can be Agents, Fleet Owners, or Drivers
- Campaigns belong to Users (creators)
- Prospects can be assigned to Agents
- QR codes can be linked to Campaigns or Cars
- Commissions are earned by Agents from Prospects
- Cars belong to Fleet Owners and can be assigned to Drivers

## Environment Variables

```env
# Server Configuration
NODE_ENV=development
PORT=3001

# Database
DB_HOST=localhost
DB_PORT=5432
DB_NAME=mktr_db
DB_USER=mktr_user
DB_PASSWORD=mktr_password

# JWT
JWT_SECRET=your-super-secret-jwt-key
JWT_EXPIRES_IN=7d

# CORS
CORS_ORIGIN=http://localhost:5173

# File Uploads
MAX_FILE_SIZE=10485760
UPLOAD_PATH=uploads/

# Email (optional)
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_USER=your-email@gmail.com
EMAIL_PASSWORD=your-app-password
```

## Scripts

- `npm start` - Start production server
- `npm run dev` - Start development server with nodemon
- `npm test` - Run tests
- `npm run migrate` - Run database migrations
- `npm run seed` - Seed database with sample data
- `npm run docker:build` - Build Docker image
- `npm run docker:run` - Run with Docker Compose

## Deployment

### Using Render

1. **Connect your GitHub repository to Render**
2. **Set environment variables in Render dashboard**
3. **Deploy automatically on git push**

### Using Docker

```bash
# Build production image
docker build -t mktr-backend .

# Run container
docker run -d \
  -p 3001:3001 \
  --env-file .env \
  mktr-backend
```

### Database Migration

For production deployments:

```bash
# Run migrations
npm run migrate

# Seed initial data (optional)
npm run seed
```

## Testing

```bash
# Run all tests
npm test

# Run with coverage
npm run test:coverage

# Run specific test file
npm test -- --grep "auth"
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests for new functionality
5. Run tests and ensure they pass
6. Submit a pull request

## Security

- JWT tokens for authentication
- Role-based access control
- Input validation with Joi
- SQL injection protection with Sequelize
- Rate limiting on API endpoints
- File upload restrictions
- CORS configuration

## Performance

- Database indexing for common queries
- Connection pooling
- Compression middleware
- Response caching headers
- Optimized database queries with eager loading

## Monitoring

- Health check endpoint: `/health`
- Request logging with Morgan
- Error tracking and logging
- Performance metrics

## License

MIT License - see LICENSE file for details

## Support

For support, please open an issue on GitHub or contact the development team.
