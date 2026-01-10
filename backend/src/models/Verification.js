import { Model, DataTypes } from 'sequelize';
import { sequelize } from '../database/connection.js';

class Verification extends Model { }

Verification.init({
    phone: {
        type: DataTypes.STRING,
        primaryKey: true,
        allowNull: false
    },
    code: {
        type: DataTypes.STRING(6),
        allowNull: false
    },
    attempts: {
        type: DataTypes.INTEGER,
        defaultValue: 0
    },
    // We can use TTL or a scheduled job to clean up, but for now
    // we'll check expiration on verify
    expiresAt: {
        type: DataTypes.DATE,
        allowNull: false
    }
}, {
    sequelize,
    modelName: 'Verification',
    tableName: 'verifications',
    timestamps: true
});

export default Verification;
