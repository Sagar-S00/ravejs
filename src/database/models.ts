/**
 * MongoDB Schema Definitions
 * Type definitions for MongoDB collections
 */

import { Document } from 'mongodb';

/**
 * Credentials collection (singleton document)
 * Stores bot authentication credentials synced with credentials.json
 */
export interface CredentialsDocument extends Document {
  _id: string;  // Always "bot_credentials" (singleton)
  email: string;
  deviceId: string;
  ssaid: string;
  parseId?: string;
  parseToken?: string;
  authToken: string;
  userId?: number;
  peerId: string;
  updatedAt: Date;
}

/**
 * Admin users collection
 * Stores global admin user IDs with metadata
 */
export interface AdminUserDocument extends Document {
  _id: string;  // userId as string
  userId: number;
  addedBy: number;  // userId of admin who added them
  addedAt: Date;
  isActive: boolean;
}

/**
 * Command permissions collection
 * Stores dynamic command access control configuration
 */
export interface CommandPermissionDocument extends Document {
  _id: string;  // command name
  commandName: string;
  requiresAdmin: boolean;
  description: string;
  updatedAt: Date;
  updatedBy: number;  // userId who last updated
}

/**
 * Collection names
 */
export const Collections = {
  CREDENTIALS: 'credentials',
  ADMIN_USERS: 'admin_users',
  COMMAND_PERMISSIONS: 'command_permissions'
} as const;

/**
 * Credentials data for IPC communication
 */
export interface CredentialsData {
  email: string;
  deviceId: string;
  ssaid: string;
  parseId?: string;
  parseToken?: string;
  authToken: string;
  userId?: number;
  peerId: string;
}
