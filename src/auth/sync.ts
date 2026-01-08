/**
 * Credential Synchronization
 * Syncs credentials between MongoDB and JSON file
 */

import { credentialsRepo } from '../database/repositories';
import { CredentialsData } from '../database/models';
import { loadCredentials, saveCredentials, Credentials } from './credentials';

/**
 * Strip "r: " prefix from token if present
 */
function stripTokenPrefix(token?: string): string | undefined {
  if (!token) return token;
  return token.startsWith('r: ') ? token.substring(3) : token;
}

/**
 * Sync credentials from JSON file to MongoDB
 */
export async function syncCredentialsToMongoDB(): Promise<void> {
  try {
    // Load from JSON file
    const credentials = await loadCredentials();
    
    if (!credentials) {
      console.log('[CredentialSync] No credentials found in JSON file');
      return;
    }

    // Convert to CredentialsData format
    const data: CredentialsData = {
      email: credentials.email,
      deviceId: credentials.deviceId,
      ssaid: credentials.ssaid,
      parseId: credentials.parseId,
      parseToken: credentials.parseToken,
      authToken: credentials.authToken || credentials.parseToken || '',
      userId: credentials.userId,
      peerId: credentials.peerId || ''
    };

    // Save to MongoDB
    await credentialsRepo.saveCredentials(data);
    console.log('[CredentialSync] Synced credentials to MongoDB');
  } catch (error: any) {
    console.error(`[CredentialSync] Failed to sync to MongoDB: ${error.message}`);
    throw error;
  }
}

/**
 * Sync credentials from MongoDB to JSON file
 */
export async function syncCredentialsFromMongoDB(): Promise<Credentials | null> {
  try {
    // Load from MongoDB
    const doc = await credentialsRepo.getCredentials();
    
    if (!doc) {
      console.log('[CredentialSync] No credentials found in MongoDB');
      return null;
    }

    // Convert to Credentials format (tokens should already be stripped, but ensure they are)
    const credentials: Credentials = {
      email: doc.email,
      deviceId: doc.deviceId,
      ssaid: doc.ssaid,
      parseId: doc.parseId,
      parseToken: stripTokenPrefix(doc.parseToken),
      authToken: stripTokenPrefix(doc.authToken),
      userId: doc.userId,
      peerId: doc.peerId
    };

    // Save to JSON file
    await saveCredentials(credentials);
    console.log('[CredentialSync] Synced credentials from MongoDB to JSON');
    
    return credentials;
  } catch (error: any) {
    console.error(`[CredentialSync] Failed to sync from MongoDB: ${error.message}`);
    throw error;
  }
}

/**
 * Ensure credentials are synchronized between both sources
 * Prioritizes MongoDB as the source of truth
 */
export async function ensureCredentialsSync(): Promise<Credentials | null> {
  try {
    // Try to load from MongoDB first
    const mongoCredentials = await credentialsRepo.getCredentials();
    
    if (mongoCredentials) {
      // MongoDB has credentials, sync to JSON
      return await syncCredentialsFromMongoDB();
    }

    // MongoDB doesn't have credentials, try JSON
    const jsonCredentials = await loadCredentials();
    
    if (jsonCredentials) {
      // JSON has credentials, sync to MongoDB
      await syncCredentialsToMongoDB();
      return jsonCredentials;
    }

    // No credentials in either location
    console.log('[CredentialSync] No credentials found in MongoDB or JSON');
    return null;
  } catch (error: any) {
    console.error(`[CredentialSync] Failed to ensure sync: ${error.message}`);
    throw error;
  }
}

/**
 * Update credentials in both MongoDB and JSON file
 */
export async function updateCredentials(credentials: Credentials): Promise<void> {
  try {
    // Convert to CredentialsData format (strip "r: " prefix from tokens)
    const data: CredentialsData = {
      email: credentials.email,
      deviceId: credentials.deviceId,
      ssaid: credentials.ssaid,
      parseId: credentials.parseId,
      parseToken: stripTokenPrefix(credentials.parseToken),
      authToken: stripTokenPrefix(credentials.authToken || credentials.parseToken) || '',
      userId: credentials.userId,
      peerId: credentials.peerId || ''
    };

    // Save to both sources
    await Promise.all([
      credentialsRepo.saveCredentials(data),
      saveCredentials(credentials)
    ]);

    console.log('[CredentialSync] Updated credentials in both MongoDB and JSON');
  } catch (error: any) {
    console.error(`[CredentialSync] Failed to update credentials: ${error.message}`);
    throw error;
  }
}
