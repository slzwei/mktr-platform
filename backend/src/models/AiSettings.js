import { DataTypes } from 'sequelize';
import { sequelize } from '../database/connection.js';

const AiSettings = sequelize.define('AiSettings', {
  id: { type: DataTypes.STRING(32), primaryKey: true, defaultValue: 'global' },
  defaultProvider: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'openai' },
  openaiModel: { type: DataTypes.STRING(100), allowNull: false, defaultValue: 'gpt-5.6-terra' },
  anthropicModel: { type: DataTypes.STRING(100), allowNull: false, defaultValue: 'claude-sonnet-4-6' },
  openaiKeyEncrypted: { type: DataTypes.TEXT, allowNull: true },
  openaiKeyHint: { type: DataTypes.STRING(12), allowNull: true },
  anthropicKeyEncrypted: { type: DataTypes.TEXT, allowNull: true },
  anthropicKeyHint: { type: DataTypes.STRING(12), allowNull: true },
  globalGuardrails: { type: DataTypes.TEXT, allowNull: false, defaultValue: '' },
  workstylePreferences: { type: DataTypes.TEXT, allowNull: false, defaultValue: '' },
  updatedBy: { type: DataTypes.UUID, allowNull: true },
}, {
  tableName: 'ai_settings',
});

export default AiSettings;
