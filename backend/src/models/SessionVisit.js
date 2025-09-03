import { DataTypes } from 'sequelize';
import { sequelize } from '../database/connection.js';

const SessionVisit = sequelize.define('SessionVisit', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  sessionId: {
    type: DataTypes.STRING(64),
    allowNull: false
  },
  startedAt: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW
  },
  landingPath: {
    type: DataTypes.STRING,
    allowNull: true
  },
  utmSource: { type: DataTypes.STRING, allowNull: true },
  utmMedium: { type: DataTypes.STRING, allowNull: true },
  utmCampaign: { type: DataTypes.STRING, allowNull: true },
  utmTerm: { type: DataTypes.STRING, allowNull: true },
  utmContent: { type: DataTypes.STRING, allowNull: true },
  eventsJson: {
    type: DataTypes.JSON,
    defaultValue: [],
    allowNull: false
  }
}, {
  tableName: 'session_visits',
  indexes: [
    { fields: ['sessionId'] }
  ]
});

export default SessionVisit;


