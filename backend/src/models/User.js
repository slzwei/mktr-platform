import { DataTypes } from 'sequelize';
import { sequelize } from '../database/connection.js';
import bcrypt from 'bcryptjs';

const User = sequelize.define('User', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  email: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true,
    validate: {
      isEmail: true
    }
  },
  password: {
    type: DataTypes.STRING,
    allowNull: true, // Allow null for Google OAuth users
    validate: {
      len: [6, 255]
    }
  },
  firstName: {
    type: DataTypes.STRING,
    allowNull: true,
    validate: {
      len: [1, 50]
    }
  },
  lastName: {
    type: DataTypes.STRING,
    allowNull: true,
    validate: {
      len: [1, 50]
    }
  },
  role: {
    type: DataTypes.ENUM('admin', 'agent', 'fleet_owner', 'driver_partner', 'customer'),
    allowNull: false,
    defaultValue: 'customer'
  },
  phone: {
    type: DataTypes.STRING,
    allowNull: true,
    validate: {
      len: [8, 20]
    }
  },
  companyName: {
    type: DataTypes.STRING,
    allowNull: true,
    validate: {
      len: [1, 100]
    }
  },
  dateOfBirth: {
    type: DataTypes.DATEONLY,
    allowNull: true
  },
  avatar: {
    type: DataTypes.STRING,
    allowNull: true
  },
  isActive: {
    type: DataTypes.BOOLEAN,
    defaultValue: true
  },
  lastLogin: {
    type: DataTypes.DATE,
    allowNull: true
  },
  emailVerified: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  emailVerificationToken: {
    type: DataTypes.STRING,
    allowNull: true
  },
  resetPasswordToken: {
    type: DataTypes.STRING,
    allowNull: true
  },
  resetPasswordExpires: {
    type: DataTypes.DATE,
    allowNull: true
  },
  invitationToken: {
    type: DataTypes.STRING,
    allowNull: true
  },
  invitationExpires: {
    type: DataTypes.DATE,
    allowNull: true
  },
  fullName: {
    type: DataTypes.STRING,
    allowNull: true,
    validate: {
      len: [1, 100]
    }
  },
  avatarUrl: {
    type: DataTypes.STRING,
    allowNull: true
  },
  googleSub: {
    type: DataTypes.STRING,
    allowNull: true
  },
  owed_leads_count: {
    type: DataTypes.INTEGER,
    allowNull: true,
    defaultValue: 0
  },
  approvalStatus: {
    type: DataTypes.ENUM('pending', 'approved', 'rejected'),
    allowNull: false,
    defaultValue: 'pending'
  }
}, {
  tableName: 'users',
  hooks: {
    // Ensure name fields stay in sync whether client sends first/last or full name
    beforeValidate: (user) => {
      // If first/last provided but fullName missing, compose it
      const hasFirst = !!user.firstName && String(user.firstName).trim().length > 0;
      const hasLast = !!user.lastName && String(user.lastName).trim().length > 0;
      if ((hasFirst || hasLast) && !user.fullName) {
        const composed = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
        if (composed) user.fullName = composed;
      }

      // If fullName provided but first/last missing, split it
      const hasFull = !!user.fullName && String(user.fullName).trim().length > 0;
      if (hasFull && !hasFirst && !hasLast) {
        const parts = String(user.fullName).trim().split(/\s+/);
        user.firstName = parts[0] || user.firstName || null;
        user.lastName = parts.slice(1).join(' ') || parts[0] || user.lastName || null;
      }
    },
    beforeCreate: async (user) => {
      if (user.password) {
        const salt = await bcrypt.genSalt(10);
        user.password = await bcrypt.hash(user.password, salt);
      }
    },
    beforeUpdate: async (user) => {
      if (user.changed('password')) {
        const salt = await bcrypt.genSalt(10);
        user.password = await bcrypt.hash(user.password, salt);
      }
    }
  }
});

// Instance methods
User.prototype.comparePassword = async function(candidatePassword) {
  // If password is not set (e.g., Google OAuth users), treat as mismatch
  if (!this.password || typeof this.password !== 'string') {
    return false;
  }
  if (!candidatePassword || typeof candidatePassword !== 'string') {
    return false;
  }
  return bcrypt.compare(candidatePassword, this.password);
};

User.prototype.toJSON = function() {
  const values = Object.assign({}, this.get());
  delete values.password;
  delete values.emailVerificationToken;
  delete values.resetPasswordToken;
  delete values.resetPasswordExpires;
  // Provide snake_case alias expected by some frontend code
  if (!values.full_name) {
    values.full_name = values.fullName || [values.firstName, values.lastName].filter(Boolean).join(' ').trim() || null;
  }
  // Computed status for UI compatibility
  if (values.approvalStatus === 'pending') {
    values.status = 'pending_approval';
  } else {
    const isPendingRegistration = this.role === 'agent' && !this.password && !this.emailVerified;
    values.status = isPendingRegistration ? 'pending_registration' : (this.isActive ? 'active' : 'inactive');
  }
  // Alias createdAt to created_date for UI compatibility
  if (!values.created_date && values.createdAt) {
    values.created_date = values.createdAt;
  }
  return values;
};

export default User;
