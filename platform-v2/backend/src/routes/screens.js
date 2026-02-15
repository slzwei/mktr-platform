import express from 'express';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { v4 as uuidv4 } from 'uuid';

dotenv.config();

const router = express.Router();
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// Get all screens
router.get('/', async (req, res) => {
    const { data, error } = await supabase.from('screens').select('*').order('created_at', { ascending: false });

    if (error) {
        return res.status(500).json({ error: error.message });
    }

    res.json(data);
});

// Register a new screen (or update existing if re-registering by pairing code?)
// For now, simple create.
router.post('/', async (req, res) => {
    const { name, pairing_code } = req.body;

    if (!name) {
        return res.status(400).json({ error: 'Name is required' });
    }

    // Check if pairing code exists
    if (pairing_code) {
        const { data: existing } = await supabase
            .from('screens')
            .select('id')
            .eq('pairing_code', pairing_code)
            .single();

        if (existing) {
            return res.status(400).json({ error: 'Pairing code already in use' });
        }
    }

    const { data, error } = await supabase
        .from('screens')
        .insert([{
            name,
            pairing_code: pairing_code || uuidv4().substring(0, 8).toUpperCase(),
            status: 'offline'
        }])
        .select()
        .single();

    if (error) {
        return res.status(500).json({ error: error.message });
    }

    res.status(201).json(data);
});

// Update screen status (heartbeat)
router.post('/:id/heartbeat', async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;

    const { data, error } = await supabase
        .from('screens')
        .update({ status: status || 'online', last_seen_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single();

    if (error) {
        return res.status(500).json({ error: error.message });
    }

    res.json(data);
});

export default router;
