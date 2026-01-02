import { DataTypes } from 'sequelize';
import { sequelize } from '../database/connection.js';

const LeadPackageAssignment = sequelize.define('LeadPackageAssignment', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    agentId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
            model: 'users',
            key: 'id'
        }
    },
    leadPackageId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
            model: 'lead_packages',
            key: 'id'
        }
    },
    status: {
        type: DataTypes.ENUM('active', 'completed', 'cancelled', 'expired'),
        defaultValue: 'active'
    },
    leadsRemaining: {
        type: DataTypes.INTEGER,
        allowNull: false,
        validate: {
            min: 0
        }
    },
    leadsTotal: {
        type: DataTypes.INTEGER,
        allowNull: false,
        comment: 'Snapshot of total leads at time of assignment'
    },
    purchaseDate: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW
    },
    priceSnapshot: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        comment: 'Snapshot of price at time of assignment'
    }
}, {
    tableName: 'lead_package_assignments',
    indexes: [
        {
            fields: ['agentId']
        },
        {
            fields: ['leadPackageId']
        },
        {
            fields: ['status']
        }
    ]
});

export default LeadPackageAssignment;
