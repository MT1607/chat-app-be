import { DataTypes, Model, type Optional } from 'sequelize';

import { sequelize } from '@/db/sequelize';
import UserCredentials from './user-credential.model';

interface RefreshTokenAttributes {
  id: string;
  tokenId: string;
  userCredentialId: string;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

type RefreshTokenCreationAttributes = Optional<
  RefreshTokenAttributes,
  'id' | 'createdAt' | 'updatedAt'
>;

export class RefreshToken
  extends Model<RefreshTokenAttributes, RefreshTokenCreationAttributes>
  implements RefreshTokenAttributes
{
  declare id: string;
  declare tokenId: string;
  declare userCredentialId: string;
  declare expiresAt: Date;
  declare createdAt: Date;
  declare updatedAt: Date;
}

RefreshToken.init(
  {
    id: {
      type: DataTypes.UUID,
      primaryKey: true,
      defaultValue: DataTypes.UUIDV4,
    },
    tokenId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    userCredentialId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    expiresAt: {
      type: DataTypes.DATE,
      allowNull: false,
    },
    createdAt: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
    updatedAt: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
  },
  {
    sequelize,
    modelName: 'RefreshToken',
    tableName: 'refresh_tokens',
    timestamps: true,
  }
);

UserCredentials.hasMany(RefreshToken, {
  foreignKey: 'userCredentialId',
  as: 'refreshTokens',
  onDelete: 'CASCADE',
});
RefreshToken.belongsTo(UserCredentials, {
  foreignKey: 'userCredentialId',
  as: 'userCredential',
});

export default RefreshToken;
