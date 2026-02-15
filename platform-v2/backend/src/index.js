import express from 'express';
import { createServer } from 'http';
import cors from 'cors';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import screensRouter from './routes/screens.js';
import { socketService } from './services/socketService.js';

dotenv.config();

const app = express();
const httpServer = createServer(app);

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Initialize Socket Service
socketService.init(httpServer);

// Routes
app.use('/api/screens', screensRouter);

// Supabase Setup (kept for legacy reference or direct usage if needed elsewhere)
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('Missing Supabase credentials in .env');
    // process.exit(1); // Don't crash in dev if env is missing, just warn
}

// Basic Route
app.get('/', (req, res) => {
    res.send('MKTR Platform V2 Backend is running');
});

// Start Server
const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is running on port ${PORT}`);
    console.log(`Supabase URL: ${supabaseUrl}`);
});
