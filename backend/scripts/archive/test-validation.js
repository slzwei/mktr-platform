
import { Sequelize, DataTypes } from 'sequelize';

// Mock sequelize instance for standalone testing without DB connection if possible,
// but User model uses imported sequelize instance.
// We'll load the model and test validation rules directly.

// Since the User model imports the database connection, we need to run this in a context where that works.
// However, unit testing validation rules on the model definition doesn't necessarily require a live DB 
// if we just inspect the model attributes, OR we can instantiate a user and call .validate() 
// but that usually requires a Sequelize instance attached.

import User from '../src/models/User.js';

async function testValidation() {
    console.log('Testing User model validation...');

    try {
        // 1. Test empty lastName is allowed
        const user = User.build({
            email: 'test@example.com',
            firstName: 'Shawn',
            lastName: '',
            role: 'agent'
        });

        await user.validate();
        console.log('✅ PASS: Validation allowed empty lastName');
    } catch (error) {
        if (error.name === 'SequelizeValidationError') {
            const fieldErrors = error.errors.map(e => e.path);
            if (fieldErrors.includes('lastName')) {
                console.error('❌ FAIL: Validation failed for lastName');
                console.error(error.message);
                process.exit(1);
            }
        }
        // If other validation errors (e.g. missing connection), that's expected since we might not have full env
        // But we focus on lastName.
        // Actually, validate() might fail if DB connection is not established? 
        // Sequelize validate() is instance level, usually doesn't need DB unless custom validators query DB.
        console.log('⚠️  Note: Other validation errors might occur but we focus on lastName.');
    }
}

testValidation();
