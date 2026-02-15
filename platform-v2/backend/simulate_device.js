import { io } from 'socket.io-client';

const BACKEND_URL = 'http://localhost:3000';
const DEVICE_ID = 'test-device-001'; // Mock ID
// In real app, ID is UUID. For test, ensure DB has this ID or we auto-create? 
// Current backend endpoints might assume UUID or existing ID.
// Let's use a real-looking UUID to be safe, or ensure we create it first.
// Actually, `register-device` in `SocketService` just updates status. It assumes device exists?
// "socketService.js": `supabase.from('screens').update(...)`. Yes, it expects row to exist.
// We should probably create it via API first if not exists, or just pick an existing one from DB.
// For now, I'll use a hardcoded UUID that I will manually Insert into DB if needed, or I'll genericize.

// Let's use one from the list we saw earlier if possible, or just a random one.
const MOCK_UUID = '00000000-0000-0000-0000-000000000001';

const socket = io(BACKEND_URL);

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
