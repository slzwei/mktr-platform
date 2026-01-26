
import axios from 'axios';
import FormData from 'form-data';
import fs from 'fs';
import path from 'path';

const API_URL = 'http://localhost:3001/api';

// Simple dummy MP4 header (ftypisom) to trick basic mime checks if any, 
// though multer mostly trusts extension/header from client unless magic bytes are checked.
const dummyMp4Content = Buffer.from([
    0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70,
    0x69, 0x73, 0x6f, 0x6d, 0x00, 0x00, 0x02, 0x00,
    0x69, 0x73, 0x6f, 0x6d, 0x69, 0x73, 0x6f, 0x32,
    0x61, 0x76, 0x63, 0x31
]);

const run = async () => {
    try {
        // 1. Login (using a known dev account or creating one, assuming 'admin@example.com' / 'password' exists or similar)
        // For simplicity, we'll try to get a token via a direct login if possible, or use a hardcoded dev token logic if available.
        // Checking previous logs/context, I don't have a sure-fire login. 
        // PRO TIP: In dev mode, I might be able to create a user or just use a known one.
        // Let's assume standard dev creds: admin@example.com / password123 (common convention in this codebase?)
        // If not, I'll error out and ask user to test manually.

        let token;
        try {
            const loginRes = await axios.post(`${API_URL}/auth/login`, {
                email: 'admin@mktr.com', // Guessing standard admin
                password: 'password123'
            });
            token = loginRes.data.data.token;
        } catch (e) {
            console.log("Login failed with admin@mktr.com. Trying fallback...");
            // If login fails, I'll try to just start the server and let the user know I can't auto-verify 
            // without credentials. BUT, I can check if there's a system agent or successful previous login in logs.
            // Actually, I can use the `test-utils` or similar if they exist.
            // Let's just create a temporary file and try to upload it.
            console.error("Skipping auto-verify due to missing creds. Requesting manual user verification.");
            return;
        }

        // 2. Create dummy file
        const filePath = path.join(process.cwd(), 'test_vid.mp4');
        fs.writeFileSync(filePath, dummyMp4Content);

        // 3. Upload
        const form = new FormData();
        form.append('file', fs.createReadStream(filePath));

        const uploadRes = await axios.post(`${API_URL}/uploads/single?type=campaign_media`, form, {
            headers: {
                ...form.getHeaders(),
                'Authorization': `Bearer ${token}`
            }
        });

        console.log("Upload Response:", uploadRes.data);

        if (uploadRes.data.success && uploadRes.data.data.file.mimetype === 'video/mp4') {
            console.log("SUCCESS: MP4 uploaded successfully!");
        } else {
            console.error("FAILURE: Upload did not return success or correct mimetype.");
        }

        // Cleanup
        fs.unlinkSync(filePath);

    } catch (error) {
        console.error("Test Failed:", error.response ? error.response.data : error.message);
    }
};

run();
