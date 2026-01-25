import { DataTypes, Model } from 'sequelize';
import { sequelize } from '../database/connection.js';

class Vehicle extends Model { }

Vehicle.init({
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    carplate: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true
    },
    masterDeviceId: {
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: 'devices', key: 'id' }
    },
    slaveDeviceId: {
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: 'devices', key: 'id' }
    },
    campaignIds: {
        type: DataTypes.JSON,
        allowNull: false,
        defaultValue: []
    },
    hotspotSsid: {
        type: DataTypes.STRING,
        allowNull: true
    },
    hotspotPassword: {
        type: DataTypes.STRING,
        allowNull: true
    },
    status: {
        type: DataTypes.ENUM('active', 'inactive'),
        allowNull: false,
        defaultValue: 'active'
    }
}, {
    sequelize,
    modelName: 'Vehicle',
    tableName: 'vehicles',
    indexes: [
        { unique: true, fields: ['carplate'] },
        { fields: ['masterDeviceId'] },
        { fields: ['slaveDeviceId'] }
    ]
});

export default Vehicle;
