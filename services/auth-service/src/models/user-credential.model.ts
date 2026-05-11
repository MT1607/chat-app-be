import { DataTypes, Model, type Optional } from 'sequelize';

import { sequelize } from '@/db/sequelize';

interface UserCredentialAttributes {
  id: string;
  email: string;
  displayName: string;
  passwordHash: string;
  createdAt: Date;
  updatedAt: Date;
}

type UserCredentialCreationAttributes = Optional<
  UserCredentialAttributes,
  'id' | 'createdAt' | 'updatedAt'
>;

export class UserCredentials
  extends Model<UserCredentialAttributes, UserCredentialCreationAttributes>
  implements UserCredentialAttributes
{
  declare id: string;
  declare email: string;
  declare displayName: string;
  declare passwordHash: string;
  declare createdAt: Date;
  declare updatedAt: Date;
}

UserCredentials.init(
  {
    id: {
      type: DataTypes.UUID,
      primaryKey: true,
      defaultValue: DataTypes.UUIDV4,
    },
    email: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
      validate: {
        isEmail: true,
      },
    },
    displayName: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    passwordHash: {
      type: DataTypes.STRING,
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
    modelName: 'UserCredentials',
    tableName: 'user_credentials',
    timestamps: true,
  }
);

export default UserCredentials;
