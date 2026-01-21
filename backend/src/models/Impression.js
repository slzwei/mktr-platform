import { DataTypes, Model } from 'sequelize';
import { sequelize } from '../database/connection.js';

class Impression extends Model { }

Impression.init({
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    deviceId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
            model: 'devices',
            key: 'id'
        }
    },
    campaignId: {
        type: DataTypes.UUID,
        allowNull: true,
        references: {
            model: 'campaigns',
            key: 'id'
        }
    },
    adId: {
        // The asset/playlist item ID (e.g. "asset_123")
        type: DataTypes.STRING,
        allowNull: false
    },
    mediaType: {
        // "image" or "video"
        type: DataTypes.STRING,
        allowNull: true
    },
    durationMs: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0
    },
    occurredAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW
    }
}, {
    sequelize,
    modelName: 'Impression',
    tableName: 'impressions',
    updatedAt: false, // Immutable log
    indexes: [
        { fields: ['deviceId'] },
        { fields: ['campaignId'] },
        { fields: ['occurredAt'] }
    ]
});

export default Impression;
