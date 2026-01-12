
import { Prospect, sequelize } from '../src/models/index.js';

async function testModelValidation() {
    try {
        await sequelize.authenticate();
        console.log('Database connected.');

        // Sync not needed if tables exist? Or simplistic sync?
        // We assume tables exist.

        const payload = {
            firstName: 'ShaneTest',
            email: 'shane.model.test@test.com',
            leadSource: 'website',
            // lastName missing
        };

        console.log('Attempting to build Prospect with:', payload);
        const p = Prospect.build(payload);

        try {
            await p.validate();
            console.log('Validation passed!');
        } catch (err) {
            console.error('Validation failed:', err.message);
            if (err.errors) {
                err.errors.forEach(e => console.error(`- ${e.message}`));
            }
        }

    } catch (err) {
        console.error('Setup error:', err);
    } finally {
        await sequelize.close();
    }
}

testModelValidation();
