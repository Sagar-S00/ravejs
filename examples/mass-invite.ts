/**
 * Mass Invite Script
 * 
 * This script:
 * 1. Logs in and saves credentials to config/credentials.json
 * 2. Gets all global chats (like ?invite all public)
 * 3. Joins 30 global chats
 * 4. For each chat: collects members, invites in batches of 80, sends mentions, then leaves
 * 5. Tries to join all 30 chats simultaneously and send invites + mentions simultaneously
 */

import { RaveLogin } from '../src/auth/login';
import { saveCredentials, loadCredentials } from '../src/auth/credentials';
import { RaveAPIClient } from '../src/api/client';
import { getMeshesWithFilters, getMeshInfo, inviteUsers, leaveMesh, getMeshes } from '../src/utils/helpers';
import { RaveWebSocketClient } from '../src/websocket/client';
import * as readline from 'readline';

interface MeshData {
  meshId: string;
  server?: string;
  users: Array<{ id: number; handle?: string; displayName?: string; name?: string }>;
}

/**
 * Delete invite from a mesh (without leaving)
 */
async function deleteInvite(
  meshId: string,
  apiClient: RaveAPIClient
): Promise<boolean> {
  try {
    const deleteInviteResponse = await apiClient.delete(`/meshes/${meshId}/invites`);
    if (deleteInviteResponse.status === 200 || deleteInviteResponse.status === 204) {
      return true;
    } else {
      console.warn(`Failed to delete invite from mesh ${meshId}: ${deleteInviteResponse.status}`);
      return false;
    }
  } catch (error: any) {
    console.error(`Error deleting invite from mesh ${meshId}:`, error.message);
    return false;
  }
}

/**
 * Delete all invites from all meshes the bot is in
 */
async function deleteAllInvites(
  deviceId: string,
  authToken: string
): Promise<void> {
  console.log("\n[0/4] Deleting all invites from all meshes...");
  const apiClient = new RaveAPIClient("https://api.red.wemesh.ca", authToken);
  
  try {
    // Get all invited meshes
    let cursor: string | undefined = undefined;
    let hasMore = true;
    const allMeshIds: string[] = [];

    while (hasMore) {
      const meshesResponse = await getMeshesWithFilters(
        deviceId,
        {
          public: false,
          friends: false,
          local: false,
          invited: true,
          limit: 50,
          lang: "en",
          cursor: cursor
        },
        apiClient
      );

      const meshesData = meshesResponse.data || [];

      // Extract mesh IDs
      for (const meshData of meshesData) {
        const mesh = meshData.mesh || {};
        const meshId = mesh.id;
        if (meshId) {
          allMeshIds.push(meshId);
        }
      }

      // Check for next page
      const paging = meshesResponse.paging || {};
      if (paging.next) {
        try {
          const url = new URL(paging.next);
          cursor = url.searchParams.get('cursor') || undefined;
          hasMore = !!cursor;
        } catch {
          hasMore = false;
        }
      } else {
        hasMore = false;
      }

      // Small delay to avoid rate limiting
      if (hasMore) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    console.log(`Found ${allMeshIds.length} meshes with invites`);

    if (allMeshIds.length === 0) {
      console.log("✓ No invites to delete");
      return;
    }

    // Delete invites from all meshes
    let deletedCount = 0;
    for (const meshId of allMeshIds) {
      try {
        const success = await deleteInvite(meshId, apiClient);
        if (success) {
          deletedCount++;
          console.log(`✓ Deleted invite from ${meshId.substring(0, 8)}...`);
        }
        // Small delay between deletions
        await new Promise(resolve => setTimeout(resolve, 200));
      } catch (error: any) {
        console.error(`Error deleting invite from ${meshId.substring(0, 8)}...: ${error.message}`);
      }
    }

    console.log(`✓ Deleted invites from ${deletedCount}/${allMeshIds.length} meshes`);
  } catch (error: any) {
    console.error(`Error deleting all invites: ${error.message}`);
  }
}

/**
 * Process a single mesh: join, invite all collected users, mention, leave
 */
async function processMesh(
  meshData: MeshData,
  allUserIds: number[],
  allUserMetas: Array<{ handle: string; id: number }>,
  deviceId: string,
  authToken: string,
  peerId: string
): Promise<void> {
  const { meshId, server } = meshData;
  
  if (!server) {
    console.log(`[${meshId.substring(0, 8)}...] No server info, skipping`);
    return;
  }

  console.log(`[${meshId.substring(0, 8)}...] Starting processing...`);

  let wsClient: RaveWebSocketClient | null = null;

  try {
    // Get mesh info to ensure we have the server
    const apiClient = new RaveAPIClient("https://api.red.wemesh.ca", authToken);
    const meshInfo = await getMeshInfo(meshId, apiClient);
    
    if (!meshInfo.server) {
      console.log(`[${meshId.substring(0, 8)}...] No server in mesh info, skipping`);
      return;
    }

    const actualServer = meshInfo.server;
    console.log(`[${meshId.substring(0, 8)}...] Connecting to ${actualServer}...`);

    // Connect to websocket
    wsClient = new RaveWebSocketClient(
      actualServer,
      meshId,
      peerId,
      authToken,
      false, // debug
      undefined, // onMessage
      () => {
        console.log(`[${meshId.substring(0, 8)}...] Connected!`);
      },
      () => {
        console.log(`[${meshId.substring(0, 8)}...] Disconnected`);
      },
      (error) => {
        console.error(`[${meshId.substring(0, 8)}...] Error: ${error.message}`);
      }
    );

    const connected = await wsClient.connect();
    if (!connected) {
      console.log(`[${meshId.substring(0, 8)}...] Failed to connect`);
      return;
    }

    // Wait a bit for connection to stabilize
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Use the collected users from all meshes
    const userIds = allUserIds;
    const userMetas = allUserMetas;

    console.log(`[${meshId.substring(0, 8)}...] Inviting ${userIds.length} collected users`);

    if (userIds.length === 0) {
      console.log(`[${meshId.substring(0, 8)}...] No users to invite, leaving...`);
      await leaveMesh(meshId, deviceId, apiClient);
      if (wsClient) {
        await wsClient.disconnect();
      }
      return;
    }

    // Split into chunks of 80 for both invites and mentions
    const chunkSize = 80;
    const totalChunks = Math.ceil(userIds.length / chunkSize);

    console.log(`[${meshId.substring(0, 8)}...] Inviting ${userIds.length} users in ${totalChunks} batches...`);

    // Invite all users first (in chunks)
    for (let i = 0; i < userIds.length; i += chunkSize) {
      const userIdChunk = userIds.slice(i, i + chunkSize);
      
      try {
        await inviteUsers(
          meshId,
          userIdChunk,
          deviceId,
          false,
          apiClient
        );
        console.log(`[${meshId.substring(0, 8)}...] Invited batch ${Math.floor(i / chunkSize) + 1}/${totalChunks}`);
      } catch (error: any) {
        console.error(`[${meshId.substring(0, 8)}...] Error inviting batch: ${error.message}`);
      }
    }

    // Now send mention messages with 4 second delay between batches
    for (let i = 0; i < userMetas.length; i += chunkSize) {
      const userMetaChunk = userMetas.slice(i, i + chunkSize);
      const chunkNumber = Math.floor(i / chunkSize) + 1;
      
      // Build mention text for this chunk
      const mentionText = userMetaChunk.map(meta => `@${meta.handle}`).join(' ');
      
      // Send message with mentions for this chunk
      if (wsClient && wsClient.connected) {
        try {
          if (chunkNumber === 1) {
            await wsClient.sendChatMessage(
              `✅ Invited ${userIds.length} users to the mesh! (Batch ${chunkNumber}/${totalChunks}) ${mentionText}`,
              undefined,
              undefined,
              undefined,
              userMetaChunk
            );
          } else {
            await wsClient.sendChatMessage(
              `(Batch ${chunkNumber}/${totalChunks}) ${mentionText}`,
              undefined,
              undefined,
              undefined,
              userMetaChunk
            );
          }
          console.log(`[${meshId.substring(0, 8)}...] Sent mention batch ${chunkNumber}/${totalChunks}`);
        } catch (error: any) {
          console.error(`[${meshId.substring(0, 8)}...] Error sending mention batch: ${error.message}`);
        }
      }
      
      // 4 second delay between batches
      if (i + chunkSize < userMetas.length) {
        await new Promise(resolve => setTimeout(resolve, 4000));
      }
    }

    console.log(`[${meshId.substring(0, 8)}...] Completed! Leaving mesh...`);

    // Leave mesh and disconnect
    await leaveMesh(meshId, deviceId, apiClient);
    if (wsClient) {
      await wsClient.disconnect();
    }

    console.log(`[${meshId.substring(0, 8)}...] Done!`);

  } catch (error: any) {
    console.error(`[${meshId.substring(0, 8)}...] Error processing mesh: ${error.message}`);
    try {
      const apiClient = new RaveAPIClient("https://api.red.wemesh.ca", authToken);
      await leaveMesh(meshId, deviceId, apiClient);
    } catch (leaveError: any) {
      console.error(`[${meshId.substring(0, 8)}...] Error leaving mesh: ${leaveError.message}`);
    }
    if (wsClient) {
      try {
        await wsClient.disconnect();
      } catch (disconnectError: any) {
        console.error(`[${meshId.substring(0, 8)}...] Error disconnecting: ${disconnectError.message}`);
      }
    }
  }
}

/**
 * Main function
 */
async function main() {
  console.log("=".repeat(50));
  console.log("Mass Invite Script");
  console.log("=".repeat(50));

  // Step 1: Login
  console.log("\n[1/5] Logging in...");
  let deviceId: string;
  let authToken: string;
  let peerId: string;

  try {
    // Try to load existing credentials first
    const existingCreds = await loadCredentials();

    if (existingCreds && existingCreds.email) {
      console.log(`Found existing credentials for ${existingCreds.email}`);
      console.log("Attempting to use existing credentials...");
      
      // Use existing credentials
      deviceId = existingCreds.deviceId;
      authToken = existingCreds.authToken || existingCreds.parseToken || "";
      peerId = existingCreds.peerId || "";

      if (!authToken || !peerId) {
        throw new Error("Existing credentials incomplete, need to login");
      }

      console.log("✓ Using existing credentials");
    } else {
      throw new Error("No existing credentials found");
    }
  } catch (error: any) {
    // Need to login
    console.log("No valid credentials found, performing login...");
    
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    const email = await new Promise<string>((resolve) => {
      rl.question('Enter your email: ', (email) => {
        rl.close();
        resolve(email.trim());
      });
    });

    const loginClient = new RaveLogin(email);
    const loginResult = await loginClient.login(true);

    // Strip "r:" or "r: " prefix from tokens before saving
    const stripPrefix = (token?: string) => {
      if (!token) return token;
      if (token.startsWith('r: ')) {
        return token.substring(3);
      } else if (token.startsWith('r:')) {
        return token.substring(2);
      }
      return token;
    };

    // Save credentials
    const newCredentials = {
      email: email,
      deviceId: loginResult.deviceId,
      ssaid: loginResult.ssaid,
      parseId: loginResult.parseId,
      parseToken: stripPrefix(loginResult.parseToken),
      authToken: stripPrefix(loginResult.authToken || loginResult.parseToken),
      userId: loginResult.userId,
      peerId: loginResult.peerId || ''
    };

    await saveCredentials(newCredentials);
    console.log('\n✓ Credentials saved to config/credentials.json\n');

    deviceId = newCredentials.deviceId;
    authToken = newCredentials.authToken || "";
    peerId = newCredentials.peerId || "unknown_peer";
  }

  if (!deviceId || !authToken || !peerId) {
    throw new Error("Missing required credentials");
  }

  // Step 0: Delete all invites from all meshes
  await deleteAllInvites(deviceId, authToken);

  // Step 2: Get global chats and collect ALL users from ALL meshes
  console.log("\n[2/5] Fetching global chats and collecting users...");
  const apiClient = new RaveAPIClient("https://api.red.wemesh.ca", authToken);
  
  const targetMeshes = 30;
  const meshes: MeshData[] = [];
  const allUserIds: number[] = [];
  const allUserMetas: Array<{ handle: string; id: number }> = [];
  const seenUserIds = new Set<number>();
  let cursor: string | undefined = undefined;
  let totalMeshesFetched = 0;

  while (totalMeshesFetched < targetMeshes) {
    const limit = Math.min(20, targetMeshes - totalMeshesFetched);
    
    const meshesResponse = await getMeshesWithFilters(
      deviceId,
      {
        public: true,
        friends: false,
        local: false,
        invited: false,
        limit: limit,
        lang: "en",
        cursor: cursor
      },
      apiClient
    );

    const meshesData = meshesResponse.data || [];
    totalMeshesFetched += meshesData.length;

    // Extract mesh info AND collect unique users from all meshes
    for (const meshData of meshesData) {
      const mesh = meshData.mesh || {};
      const meshId = mesh.id;
      const server = mesh.server;
      const users = meshData.users || [];

      if (meshId) {
        meshes.push({
          meshId: meshId,
          server: server,
          users: users
        });

        // Collect unique users from this mesh (like inviteall public does)
        for (const user of users) {
          if (user.id && user.handle) {
            const userId = typeof user.id === 'string' ? parseInt(user.id, 10) : user.id;
            if (!isNaN(userId) && !seenUserIds.has(userId)) {
              seenUserIds.add(userId);
              allUserIds.push(userId);
              allUserMetas.push({
                handle: user.handle,
                id: userId
              });
            }
          }
        }
      }
    }

    // Check for next page
    const paging = meshesResponse.paging || {};
    if (paging.next) {
      try {
        const url = new URL(paging.next);
        cursor = url.searchParams.get('cursor') || undefined;
      } catch {
        cursor = undefined;
      }
    } else {
      cursor = undefined;
    }

    if (!cursor || meshes.length >= targetMeshes) {
      break;
    }

    // Small delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  console.log(`✓ Fetched ${meshes.length} global meshes`);
  console.log(`✓ Collected ${allUserIds.length} unique users from all meshes`);

  if (meshes.length === 0) {
    console.log("No meshes found. Exiting.");
    return;
  }

  if (allUserIds.length === 0) {
    console.log("No users found in meshes. Exiting.");
    return;
  }

  // Take only first 30 meshes
  const meshesToProcess = meshes.slice(0, 30);
  console.log(`\n[3/5] Processing ${meshesToProcess.length} meshes with ${allUserIds.length} users...`);

  // Step 3: Process all meshes in parallel (inviting all collected users to each mesh)
  console.log("\n[4/5] Joining all meshes and sending invites simultaneously...\n");

  const promises = meshesToProcess.map(meshData => 
    processMesh(meshData, allUserIds, allUserMetas, deviceId, authToken, peerId)
  );

  // Wait for all to complete
  await Promise.allSettled(promises);

  console.log("\n[5/5] Cleanup complete!");
  console.log("\n" + "=".repeat(50));
  console.log("✓ All meshes processed!");
  console.log("=".repeat(50));
}

// Run the script
main().catch(error => {
  console.error("\n✗ Script failed:", error);
  process.exit(1);
});
