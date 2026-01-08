/**
 * MongoDB Repository Classes
 * Provides CRUD operations for all collections
 */

import { Collection, Document } from 'mongodb';
import { getDatabase } from './connection';
import {
  CredentialsDocument,
  AdminUserDocument,
  CommandPermissionDocument,
  Collections,
  CredentialsData
} from './models';

/**
 * Base Repository with common operations
 */
abstract class BaseRepository<T extends Document> {
  protected collection: Collection<T>;

  constructor(collectionName: string) {
    this.collection = getDatabase().collection<T>(collectionName);
  }

  async findById(id: string): Promise<T | null> {
    return await this.collection.findOne({ _id: id } as any) as T | null;
  }

  async findAll(): Promise<T[]> {
    return await this.collection.find({}).toArray() as T[];
  }

  async deleteById(id: string): Promise<boolean> {
    const result = await this.collection.deleteOne({ _id: id } as any);
    return result.deletedCount > 0;
  }
}

/**
 * Credentials Repository
 * Manages bot credentials (singleton document)
 */
export class CredentialsRepository extends BaseRepository<CredentialsDocument> {
  private static readonly CREDENTIALS_ID = 'bot_credentials';

  constructor() {
    super(Collections.CREDENTIALS);
  }

  /**
   * Get credentials (singleton)
   */
  async getCredentials(): Promise<CredentialsDocument | null> {
    return await this.findById(CredentialsRepository.CREDENTIALS_ID);
  }

  /**
   * Save or update credentials
   */
  async saveCredentials(credentials: CredentialsData): Promise<void> {
    const doc: CredentialsDocument = {
      _id: CredentialsRepository.CREDENTIALS_ID,
      ...credentials,
      updatedAt: new Date()
    };

    await this.collection.updateOne(
      { _id: CredentialsRepository.CREDENTIALS_ID },
      { $set: doc },
      { upsert: true }
    );
  }

  /**
   * Delete credentials
   */
  async deleteCredentials(): Promise<boolean> {
    return await this.deleteById(CredentialsRepository.CREDENTIALS_ID);
  }
}

/**
 * Admin Users Repository
 * Manages global admin users
 */
export class AdminRepository extends BaseRepository<AdminUserDocument> {
  constructor() {
    super(Collections.ADMIN_USERS);
  }

  /**
   * Check if user is admin
   */
  async isAdmin(userId: number): Promise<boolean> {
    const admin = await this.findById(String(userId));
    return admin !== null && admin.isActive;
  }

  /**
   * Get all active admins
   */
  async getActiveAdmins(): Promise<AdminUserDocument[]> {
    return await this.collection.find({ isActive: true }).toArray();
  }

  /**
   * Add user as admin
   */
  async addAdmin(userId: number, addedBy: number): Promise<void> {
    const doc: AdminUserDocument = {
      _id: String(userId),
      userId,
      addedBy,
      addedAt: new Date(),
      isActive: true
    };

    await this.collection.updateOne(
      { _id: String(userId) },
      { $set: doc },
      { upsert: true }
    );
  }

  /**
   * Remove admin (soft delete - set inactive)
   */
  async removeAdmin(userId: number): Promise<boolean> {
    const result = await this.collection.updateOne(
      { _id: String(userId) },
      { $set: { isActive: false } }
    );
    return result.modifiedCount > 0;
  }

  /**
   * Remove admin (hard delete)
   */
  async deleteAdmin(userId: number): Promise<boolean> {
    return await this.deleteById(String(userId));
  }

  /**
   * Get admin user info
   */
  async getAdmin(userId: number): Promise<AdminUserDocument | null> {
    return await this.findById(String(userId));
  }
}

/**
 * Command Permissions Repository
 * Manages dynamic command access control
 */
export class PermissionRepository extends BaseRepository<CommandPermissionDocument> {
  constructor() {
    super(Collections.COMMAND_PERMISSIONS);
  }

  /**
   * Get permission for a command
   */
  async getPermission(commandName: string): Promise<CommandPermissionDocument | null> {
    return await this.findById(commandName.toLowerCase());
  }

  /**
   * Check if command requires admin
   */
  async requiresAdmin(commandName: string): Promise<boolean> {
    const permission = await this.getPermission(commandName);
    return permission?.requiresAdmin || false;
  }

  /**
   * Set command permission
   */
  async setPermission(
    commandName: string,
    requiresAdmin: boolean,
    updatedBy: number,
    description?: string
  ): Promise<void> {
    const doc: CommandPermissionDocument = {
      _id: commandName.toLowerCase(),
      commandName: commandName.toLowerCase(),
      requiresAdmin,
      description: description || `Command: ${commandName}`,
      updatedAt: new Date(),
      updatedBy
    };

    await this.collection.updateOne(
      { _id: commandName.toLowerCase() },
      { $set: doc },
      { upsert: true }
    );
  }

  /**
   * Remove permission override for command
   */
  async removePermission(commandName: string): Promise<boolean> {
    return await this.deleteById(commandName.toLowerCase());
  }

  /**
   * Get all permissions
   */
  async getAllPermissions(): Promise<CommandPermissionDocument[]> {
    return await this.findAll();
  }

  /**
   * Get admin-only commands
   */
  async getAdminCommands(): Promise<CommandPermissionDocument[]> {
    return await this.collection.find({ requiresAdmin: true }).toArray();
  }

  /**
   * Get user-accessible commands
   */
  async getUserCommands(): Promise<CommandPermissionDocument[]> {
    return await this.collection.find({ requiresAdmin: false }).toArray();
  }
}

// Lazy-initialized repository instances
let _credentialsRepo: CredentialsRepository | null = null;
let _adminRepo: AdminRepository | null = null;
let _permissionRepo: PermissionRepository | null = null;

/**
 * Get credentials repository instance (lazy initialization)
 */
export function getCredentialsRepo(): CredentialsRepository {
  if (!_credentialsRepo) {
    _credentialsRepo = new CredentialsRepository();
  }
  return _credentialsRepo;
}

/**
 * Get admin repository instance (lazy initialization)
 */
export function getAdminRepo(): AdminRepository {
  if (!_adminRepo) {
    _adminRepo = new AdminRepository();
  }
  return _adminRepo;
}

/**
 * Get permission repository instance (lazy initialization)
 */
export function getPermissionRepo(): PermissionRepository {
  if (!_permissionRepo) {
    _permissionRepo = new PermissionRepository();
  }
  return _permissionRepo;
}

// Export convenience accessors that match the old API
export const credentialsRepo = {
  get getCredentials() { return getCredentialsRepo().getCredentials.bind(getCredentialsRepo()); },
  get saveCredentials() { return getCredentialsRepo().saveCredentials.bind(getCredentialsRepo()); },
  get deleteCredentials() { return getCredentialsRepo().deleteCredentials.bind(getCredentialsRepo()); }
};

export const adminRepo = {
  get isAdmin() { return getAdminRepo().isAdmin.bind(getAdminRepo()); },
  get getActiveAdmins() { return getAdminRepo().getActiveAdmins.bind(getAdminRepo()); },
  get addAdmin() { return getAdminRepo().addAdmin.bind(getAdminRepo()); },
  get removeAdmin() { return getAdminRepo().removeAdmin.bind(getAdminRepo()); },
  get deleteAdmin() { return getAdminRepo().deleteAdmin.bind(getAdminRepo()); },
  get getAdmin() { return getAdminRepo().getAdmin.bind(getAdminRepo()); }
};

export const permissionRepo = {
  get getPermission() { return getPermissionRepo().getPermission.bind(getPermissionRepo()); },
  get requiresAdmin() { return getPermissionRepo().requiresAdmin.bind(getPermissionRepo()); },
  get setPermission() { return getPermissionRepo().setPermission.bind(getPermissionRepo()); },
  get removePermission() { return getPermissionRepo().removePermission.bind(getPermissionRepo()); },
  get getAllPermissions() { return getPermissionRepo().getAllPermissions.bind(getPermissionRepo()); },
  get getAdminCommands() { return getPermissionRepo().getAdminCommands.bind(getPermissionRepo()); },
  get getUserCommands() { return getPermissionRepo().getUserCommands.bind(getPermissionRepo()); }
};
