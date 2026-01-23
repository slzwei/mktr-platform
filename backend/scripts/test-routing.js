
import express from 'express';
// Mock routers
const deviceEventsRouter = express.Router();
deviceEventsRouter.get('/', (req, res) => res.send('deviceEvents root'));
deviceEventsRouter.get('/:id/logs/stream', (req, res) => res.send('deviceEvents stream'));

const deviceRoutes = express.Router();
deviceRoutes.get('/', (req, res) => res.send('device list'));
deviceRoutes.get('/:id', (req, res) => res.send(`device details: ${req.params.id}`));
deviceRoutes.get('/:id/logs', (req, res) => res.send(`device logs: ${req.params.id}`));

const app = express();
app.use('/api/devices/events', deviceEventsRouter);
app.use('/api/devices', deviceRoutes);

// Test
const test = async (path) => {
    console.log(`Testing ${path}...`);
    // simple internal mock since we can't easily fetch from supertest here without deps
    // wait, we can just use a quick listener
};

const server = app.listen(0, async () => {
    const port = server.address().port;
    const baseUrl = `http://localhost:${port}`;
    const fetch = (await import('node-fetch')).default || global.fetch;

    const paths = [
        '/api/devices/events',
        '/api/devices/events/123/logs/stream',
        '/api/devices',
        '/api/devices/e74a91e3-a077-41a6-9bed-2a5a01970940',
        '/api/devices/e74a91e3-a077-41a6-9bed-2a5a01970940/logs'
    ];

    for (const p of paths) {
        try {
            const res = await fetch(baseUrl + p);
            const text = await res.text();
            console.log(`GET ${p} -> ${res.status} ${text}`);
        } catch (e) {
            console.error(e);
        }
    }
    server.close();
});
