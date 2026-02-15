import { io } from 'socket.io-client';

const URL = 'https://dooh-backend.onrender.com';
export const socket = io(URL, {
    autoConnect: true
});
