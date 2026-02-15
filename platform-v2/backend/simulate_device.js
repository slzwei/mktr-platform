import { io } from 'socket.io-client';

const BACKEND_URL = 'https://dooh-backend.onrender.com';
const DEVICE_ID = 'test-device-prod-001';
// We use a fixed ID for testing so we don't spam the DB with new rows every run.
// But valid UUID format is preferred by Supabase usually? `screens.id` is UUID or TEXT?
// `supabase_schema.sql` says `id UUID PRIMARY KEY`.
// So I MUST use a valid UUID.
const MOCK_UUID = '11111111-2222-3333-4444-555555555555';

const socket = io(BACKEND_URL, {
    transports: ['websocket'] // Force websocket
});

console.log(`Connecting to ${BACKEND_URL} as ${MOCK_UUID}...`);

socket.on('connect', () => {
    console.log('Connected! Socket ID:', socket.id);

    // 1. Register
    console.log('Registering device...');
    socket.emit('register-device', MOCK_UUID);

    // 2. Send Logs loop
    setInterval(() => {
        const log = {
            type: 'INFO',
            payload: {
                memory: process.memoryUsage().heapUsed,
                battery: 100,
                timestamp: Date.now()
            }
        };
        console.log('Sending log:', log);
        socket.emit('device-log', log);
    }, 5000); // Every 5s
});

// 3. Listen for Commands
socket.on('command', (data) => {
    console.log('RECEIVED COMMAND:', data);

    // Simulate action
    if (data.command === 'REBOOT') {
        console.log('♻️ REBOOTING...');
        // In real life, we'd spawn a shell command.
    }
});

socket.on('disconnect', () => {
    console.log('Disconnected.');
});
