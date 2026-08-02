import { DataTypes, Model } from 'sequelize';
import { sequelize } from '../database/connection.js';

class IdempotencyKey extends Model {}

// Composite PK (scope, key) — P2-13, migration 104. `key` alone was the PK
// while every protocol lookup filtered by {key, scope}, so the same client
// idempotency key sent to two different scopes collided on insert while the
// scoped replay lookup returned null: the second operation 500'd instead of
// running. Scope FIRST so the index also serves scope-prefixed scans.
// Declared here as well as in the migration because test boot builds the
// schema from the MODELS via sync({force:true}) before migrations run.
IdempotencyKey.init({
  scope: {
    // e.g., 'beacon:heartbeat' or 'beacon:impression' or 'manifest'
    type: DataTypes.STRING,
    primaryKey: true,
    allowNull: false
  },
  key: {
    type: DataTypes.STRING,
    primaryKey: true
  },
  deviceId: {
    type: DataTypes.UUID,
    allowNull: true
  },
  responseBody: {
    type: DataTypes.JSON,
    allowNull: true
  },
  responseCode: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  expiresAt: {
    type: DataTypes.DATE,
    allowNull: false
  }
}, {
  sequelize,
  modelName: 'IdempotencyKey',
  tableName: 'idempotency_keys',
  indexes: [
    // No standalone `scope` index: it is the PK's leading column now.
    { fields: ['deviceId'] },
    { fields: ['expiresAt'] }
  ]
});

export default IdempotencyKey;


