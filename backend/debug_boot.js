
import dotenv from 'dotenv';
dotenv.config();

console.log('🚀 Starting debug boot...');

try {
    console.log('📦 Importing models/index.js...');
    const models = await import('./src/models/index.js');
    console.log('✅ Models imported successfully:', Object.keys(models.default));

    console.log('🚀 Importing server.js...');
    const server = await import('./src/server.js');
    console.log('✅ Server imported successfully');

    process.exit(0);
} catch (error) {
    console.error('💥 Crash detected during boot:');
    console.error(error);
    process.exit(1);
}
