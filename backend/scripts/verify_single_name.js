
import { Prospect, sequelize } from '../src/models/index.js';

async function verifySingleName() {
    try {
        await sequelize.authenticate();
        console.log('Database connected.');

        const payload = {
            firstName: 'ShaneOnly',
            lastName: '', // Explicit empty string
            email: 'shane.only@test.com',
            leadSource: 'website',
            phone: '1234567890'
        };

        console.log('Attempting to build Prospect with empty lastName:', payload);
        const p = Prospect.build(payload);

        try {
            await p.validate();
            console.log('Validation passed for empty lastName!');

            // Optionally save to DB to be sure
            // await p.save(); 
            // console.log('Saved successfully!');
            // await p.destroy();
            // console.log('Cleaned up.');

        } catch (err) {
            console.error('Validation failed:', err.message);
            if (err.errors) {
                err.errors.forEach(e => console.error(`- ${e.message}`));
            }
            process.exit(1);
        }

    } catch (err) {
        console.error('Setup error:', err);
        process.exit(1);
    } finally {
        await sequelize.close();
    }
}

verifySingleName();
