#!/bin/bash

echo "🚀 Setting up MKTR Backend..."

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo "❌ Docker is not installed. Please install Docker first."
    exit 1
fi

# Check if Docker Compose is installed
if ! command -v docker-compose &> /dev/null; then
    echo "❌ Docker Compose is not installed. Please install Docker Compose first."
    exit 1
fi

# Navigate to backend directory
cd backend

# Copy environment file if it doesn't exist
if [ ! -f .env ]; then
    echo "📝 Creating environment file..."
    cp env.example .env
    echo "✅ Environment file created. Please edit .env with your configuration."
fi

# Build and start containers
echo "🐳 Building and starting Docker containers..."
docker-compose up --build -d

# Wait for database to be ready
echo "⏳ Waiting for database to be ready..."
sleep 10

# Check if containers are running
if docker-compose ps | grep -q "Up"; then
    echo "✅ Backend is running successfully!"
    echo ""
    echo "🌐 API URL: http://localhost:3001"
    echo "💚 Health Check: http://localhost:3001/health"
    echo "📊 Database: PostgreSQL on localhost:5432"
    echo ""
    echo "📝 Next steps:"
    echo "1. Edit backend/.env file with your configuration"
    echo "2. Test the API endpoints"
    echo "3. Check logs: docker-compose logs -f"
    echo "4. Stop containers: docker-compose down"
else
    echo "❌ Failed to start containers. Check logs:"
    docker-compose logs
fi
