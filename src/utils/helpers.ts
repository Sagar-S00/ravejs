/**
 * Helper functions for Rave API operations
 */

import { RaveAPIClient } from '../api/client';
import axios from 'axios';
import * as fs from 'fs';

// Default API client instance (can be overridden)
let _defaultApiClient: RaveAPIClient | null = null;

/**
 * Set the default API client for helper functions
 */
export function setDefaultApiClient(client: RaveAPIClient): void {
  _defaultApiClient = client;
}

/**
 * Get or create the default API client
 */
export function getDefaultApiClient(): RaveAPIClient {
  if (_defaultApiClient === null) {
    _defaultApiClient = new RaveAPIClient("https://api.red.wemesh.ca", "");
  }
  return _defaultApiClient;
}

/**
 * Create a YouTube video entry and get its ID
 * 
 * @param info - Video information dictionary
 * @param apiClient - Optional API client instance (uses default if not provided)
 * @returns Video ID string
 */
export async function getVideoId(
  info: Record<string, any>,
  apiClient?: RaveAPIClient
): Promise<string> {
  const client = apiClient || getDefaultApiClient();
  const response = await client.post("/videos/youtube", info);
  return response.data?.data?.id || "";
}

/**
 * Vote for a video in a mesh
 * 
 * @param videoId - ID of the video to vote for
 * @param meshId - ID of the mesh/room
 * @param deviceId - Device ID (default: be30981dd1994a48907d4b380d505118)
 * @param apiClient - Optional API client instance (uses default if not provided)
 * @returns Response JSON dictionary
 */
export async function voteVideo(
  videoId: string,
  meshId: string,
  deviceId: string = "be30981dd1994a48907d4b380d505118",
  apiClient?: RaveAPIClient
): Promise<Record<string, any>> {
  const client = apiClient || getDefaultApiClient();
  const timestamp = Date.now();
  const payload = {
    deviceId: deviceId,
    time: timestamp,
    url: `https://api.red.wemesh.ca/videos/youtube/${videoId}`
  };
  const response = await client.post(`/meshes/${meshId}/votes`, payload);
  return response.data;
}

/**
 * Get mesh information
 * 
 * @param meshId - ID of the mesh/room
 * @param apiClient - Optional API client instance (uses default if not provided)
 * @returns Mesh info dictionary containing server, room_id, users list, and raw_response
 */
export async function getMeshInfo(
  meshId: string,
  apiClient?: RaveAPIClient
): Promise<{
  server?: string;
  roomId?: string;
  users: any[];
  rawResponse: any;
}> {
  const client = apiClient || getDefaultApiClient();
  const response = await client.get(`/meshes/${meshId}`);
  if (response.status !== 200) {
    throw new Error(`Failed to get mesh info: ${response.status}`);
  }

  const meshInfo = response.data || {};
  const data = meshInfo.data || {};
  const users = data.users || [];

  return {
    server: data.server,
    roomId: data.id,
    users: users,
    rawResponse: meshInfo
  };
}

/**
 * Get friendships list
 * 
 * @param limit - Maximum number of friendships to return (default: 50)
 * @param apiClient - Optional API client instance (uses default if not provided)
 * @returns Response JSON dictionary containing friendships data
 */
export async function getFriendships(
  limit: number = 50,
  apiClient?: RaveAPIClient
): Promise<Record<string, any>> {
  const client = apiClient || getDefaultApiClient();
  const response = await client.get("/friendships", { limit: limit });
  if (response.status !== 200) {
    throw new Error(`Failed to get friendships: ${response.status}`);
  }
  return response.data || {};
}

/**
 * Get users list by IDs
 * 
 * @param ids - List of user IDs to retrieve
 * @param deviceId - Device ID (default: be30981dd1994a48907d4b380d505118)
 * @param includeOnline - Whether to include online status (default: true)
 * @param apiClient - Optional API client instance (uses default if not provided)
 * @returns Response JSON dictionary containing users data
 */
export async function getUsersList(
  ids: number[],
  deviceId: string = "be30981dd1994a48907d4b380d505118",
  includeOnline: boolean = true,
  apiClient?: RaveAPIClient
): Promise<Record<string, any>> {
  const client = apiClient || getDefaultApiClient();
  const payload = {
    deviceId: deviceId,
    ids: ids,
    includeOnline: includeOnline
  };
  const response = await client.post("/users/list", payload);
  if (response.status !== 200) {
    throw new Error(`Failed to get users list: ${response.status}`);
  }
  return response.data || {};
}

/**
 * Get recent users/contacts
 * 
 * @param limit - Maximum number of contacts to return (default: 24)
 * @param apiClient - Optional API client instance (uses default if not provided)
 * @returns Response JSON dictionary containing contacts data
 * Format: {"data": [{...user objects...}], "paging": {...}}
 */
export async function getRecentUsers(
  limit: number = 24,
  apiClient?: RaveAPIClient
): Promise<Record<string, any>> {
  const client = apiClient || getDefaultApiClient();
  const response = await client.get("/contacts", { limit: limit });
  if (response.status !== 200) {
    throw new Error(`Failed to get recent users: ${response.status}`);
  }
  return response.data || { data: [], paging: {} };
}

/**
 * Get meshes based on mode
 * 
 * @param deviceId - Device ID (required)
 * @param mode - "invited" for only invited meshes, "public" for public meshes, "friends" for friend meshes, "all" for public + friends + invited
 * @param limit - Maximum number of meshes to return (default: 20)
 * @param lang - Language code (default: "en")
 * @param cursor - Optional cursor for pagination (from paging.next URL)
 * @param apiClient - Optional API client instance (uses default if not provided)
 * @returns Response JSON dictionary containing list of mesh data with users
 * Format: {"data": [{"mesh": {...}, "users": [...]}, ...], "paging": {...}}
 */
export async function getMeshes(
  deviceId: string,
  mode: string = "invited",
  limit: number = 20,
  lang: string = "en",
  cursor?: string,
  apiClient?: RaveAPIClient
): Promise<Record<string, any>> {
  const client = apiClient || getDefaultApiClient();

  if (mode === "all") {
    const allMeshes: any[] = [];
    const seenIds = new Set<string>();

    for (const meshType of ["public", "friends", "invited"]) {
      const params: Record<string, any> = {
        deviceId: deviceId,
        public: meshType === "public" ? "true" : "false",
        friends: meshType === "friends" ? "true" : "false",
        local: "false",
        invited: meshType === "invited" ? "true" : "false",
        limit: limit,
        lang: lang
      };
      
      // Add cursor if provided (only for first iteration to avoid confusion)
      if (cursor && meshType === "public") {
        if (cursor.includes('cursor=')) {
          const urlParams = new URLSearchParams(cursor.split('?')[1] || '');
          params.cursor = urlParams.get('cursor') || cursor;
        } else {
          params.cursor = cursor;
        }
      }
      
      const response = await client.get("/meshes/self", params);
      if (response.status === 200) {
        const data = response.data.data || [];
        for (const item of data) {
          const mesh = item.mesh || {};
          const meshId = mesh.id;
          if (meshId && !seenIds.has(meshId)) {
            allMeshes.push(item);
            seenIds.add(meshId);
          }
        }
      }
    }

    return { data: allMeshes.slice(0, limit), paging: {} };
  } else if (mode === "public") {
    // Get public meshes
    const params: Record<string, any> = {
      deviceId: deviceId,
      public: "true",
      friends: "false",
      local: "false",
      invited: "false",
      limit: limit,
      lang: lang
    };
    
    // Add cursor if provided
    if (cursor) {
      if (cursor.includes('cursor=')) {
        const urlParams = new URLSearchParams(cursor.split('?')[1] || '');
        params.cursor = urlParams.get('cursor') || cursor;
      } else {
        params.cursor = cursor;
      }
    }
    
    const response = await client.get("/meshes/self", params);
    if (response.status !== 200) {
      throw new Error(`Failed to get public meshes: ${response.status}`);
    }
    return response.data || { data: [], paging: {} };
  } else if (mode === "friends") {
    // Get friend meshes
    const params: Record<string, any> = {
      deviceId: deviceId,
      public: "false",
      friends: "true",
      local: "false",
      invited: "false",
      limit: limit,
      lang: lang
    };
    
    // Add cursor if provided
    if (cursor) {
      if (cursor.includes('cursor=')) {
        const urlParams = new URLSearchParams(cursor.split('?')[1] || '');
        params.cursor = urlParams.get('cursor') || cursor;
      } else {
        params.cursor = cursor;
      }
    }
    
    const response = await client.get("/meshes/self", params);
    if (response.status !== 200) {
      throw new Error(`Failed to get friend meshes: ${response.status}`);
    }
    return response.data || { data: [], paging: {} };
  } else {
    // Default: invited meshes
    const params: Record<string, any> = {
      deviceId: deviceId,
      public: "false",
      friends: "false",
      local: "false",
      invited: "true",
      limit: limit,
      lang: lang
    };
    
    // Add cursor if provided
    if (cursor) {
      if (cursor.includes('cursor=')) {
        const urlParams = new URLSearchParams(cursor.split('?')[1] || '');
        params.cursor = urlParams.get('cursor') || cursor;
      } else {
        params.cursor = cursor;
      }
    }
    
    const response = await client.get("/meshes/self", params);
    if (response.status !== 200) {
      throw new Error(`Failed to get meshes: ${response.status}`);
    }
    return response.data || { data: [], paging: {} };
  }
}

/**
 * Get meshes with custom filter parameters
 * 
 * @param deviceId - Device ID (required)
 * @param options - Filter options
 * @param options.public - Include public meshes (default: false)
 * @param options.friends - Include friend meshes (default: false)
 * @param options.local - Include local meshes (default: false)
 * @param options.invited - Include invited meshes (default: false)
 * @param options.limit - Maximum number of meshes to return (default: 20)
 * @param options.lang - Language code (default: "en")
 * @param options.cursor - Cursor for pagination (from paging.next URL)
 * @param apiClient - Optional API client instance (uses default if not provided)
 * @returns Response JSON dictionary containing list of mesh data with users
 * Format: {"data": [{"mesh": {...}, "users": [...]}, ...], "paging": {...}}
 */
export async function getMeshesWithFilters(
  deviceId: string,
  options: {
    public?: boolean;
    friends?: boolean;
    local?: boolean;
    invited?: boolean;
    limit?: number;
    lang?: string;
    cursor?: string;
  } = {},
  apiClient?: RaveAPIClient
): Promise<Record<string, any>> {
  const client = apiClient || getDefaultApiClient();
  
  const params: Record<string, any> = {
    deviceId: deviceId,
    public: String(options.public ?? false),
    friends: String(options.friends ?? false),
    local: String(options.local ?? false),
    invited: String(options.invited ?? false),
    limit: options.limit ?? 20,
    lang: options.lang ?? "en"
  };
  
  // Add cursor if provided (extract from URL or use directly)
  if (options.cursor) {
    // If cursor is a full URL, extract the cursor parameter
    if (options.cursor.includes('cursor=')) {
      const urlParams = new URLSearchParams(options.cursor.split('?')[1] || '');
      params.cursor = urlParams.get('cursor') || options.cursor;
    } else {
      params.cursor = options.cursor;
    }
  }
  
  const response = await client.get("/meshes/self", params);
  if (response.status !== 200) {
    throw new Error(`Failed to get meshes: ${response.status}`);
  }
  return response.data || { data: [], paging: {} };
}

/**
 * Get all meshes that the bot has been invited to (deprecated, use getMeshes instead)
 */
export async function getInvitedMeshes(
  deviceId: string,
  limit: number = 20,
  lang: string = "en",
  apiClient?: RaveAPIClient
): Promise<Record<string, any>> {
  return getMeshes(deviceId, "invited", limit, lang, undefined, apiClient);
}

/**
 * Invite users to a mesh
 * 
 * @param meshId - Mesh ID to invite users to
 * @param userIds - Array of user IDs to invite
 * @param deviceId - Device ID (required)
 * @param includeOnline - Whether to include online status (default: false)
 * @param apiClient - Optional API client instance (uses default if not provided)
 * @returns Response JSON dictionary containing success status
 * Format: {"success": true}
 */
export async function inviteUsers(
  meshId: string,
  userIds: number[],
  deviceId: string,
  includeOnline: boolean = false,
  apiClient?: RaveAPIClient
): Promise<Record<string, any>> {
  const client = apiClient || getDefaultApiClient();
  
  const payload = {
    deviceId: deviceId,
    ids: userIds,
    includeOnline: includeOnline
  };
  
  const response = await client.post(`/meshes/${meshId}/invites`, payload);
  if (response.status !== 200) {
    throw new Error(`Failed to invite users to mesh: ${response.status}`);
  }
  return response.data || { success: false };
}

/**
 * Leave a mesh
 * 
 * This function performs two operations:
 * 1. Deletes the invite from the mesh (DELETE /meshes/{mesh-id}/invites)
 * 2. Leaves the mesh (DELETE /meshes/{mesh-id}/devices/{device-id}/leave)
 * 
 * @param meshId - Mesh ID to leave
 * @param deviceId - Device ID (required)
 * @param apiClient - Optional API client instance (uses default if not provided)
 * @returns True if successful, False otherwise
 */
export async function leaveMesh(
  meshId: string,
  deviceId: string,
  apiClient?: RaveAPIClient
): Promise<boolean> {
  const client = apiClient || getDefaultApiClient();

  try {
    // Step 1: Delete the invite first
    const deleteInviteResponse = await client.delete(`/meshes/${meshId}/invites`);
    if (deleteInviteResponse.status !== 200 && deleteInviteResponse.status !== 204) {
      console.warn(`Failed to delete invite from mesh ${meshId}: ${deleteInviteResponse.status}`);
      // Continue with leave even if invite deletion fails
    }

    // Step 2: Leave the mesh
    const leaveResponse = await client.delete(`/meshes/${meshId}/devices/${deviceId}/leave`);
    if (leaveResponse.status === 200 || leaveResponse.status === 204) {
      return true;
    } else {
      console.warn(`Failed to leave mesh ${meshId}: ${leaveResponse.status}`);
      return false;
    }
  } catch (error: any) {
    console.error(`Error leaving mesh ${meshId}:`, error);
    return false;
  }
}

/**
 * Detect MIME type from file path
 */
function detectMimeType(filePath: string): string {
  const ext = filePath.toLowerCase().substring(filePath.lastIndexOf('.'));
  const mimeMap: Record<string, string> = {
    '.mp4': 'video/mp4',
    '.mov': 'video/quicktime',
    '.avi': 'video/x-msvideo',
    '.webm': 'video/webm',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp'
  };
  return mimeMap[ext] || 'application/octet-stream';
}

/**
 * Upload media files (images/videos) to a mesh
 * 
 * This function handles the complete upload flow:
 * 1. Requests upload URLs from the API
 * 2. Uploads each file to the returned S3 upload URLs
 * 3. Returns posting URLs ready for use in chat messages
 * 
 * @param meshId - ID of the mesh/room
 * @param mediaFiles - List of file paths to upload
 * @param isExplicit - Whether the media is explicit (default: false)
 * @param apiClient - Optional API client instance (uses default if not provided)
 * @returns List of media info dictionaries for chat messages
 */
export async function uploadMedia(
  meshId: string,
  mediaFiles: string[],
  isExplicit: boolean = false,
  apiClient?: RaveAPIClient
): Promise<Array<{
  url: string;
  mime: string;
  isExplicit: boolean;
  aspectRatio: string;
  thumbnailUrl: string;
}>> {
  const client = apiClient || getDefaultApiClient();

  // Step 1: Prepare upload request
  const mediaItems = mediaFiles.map((filePath, index) => ({
    index: index,
    mime: detectMimeType(filePath),
    isExplicit: isExplicit
  }));

  const uploadRequest = {
    media: mediaItems
  };

  // Step 2: Request upload URLs
  const response = await client.post(`/meshes/${meshId}/images/upload`, uploadRequest);

  if (response.status !== 200) {
    throw new Error(`Failed to get upload URLs: ${response.status} - ${JSON.stringify(response.data)}`);
  }

  const responseData = response.data?.data || [];

  // Step 3: Upload each file to S3
  const postingUrls: Array<{
    url: string;
    mime: string;
    isExplicit: boolean;
    aspectRatio: string;
    thumbnailUrl: string;
  }> = [];

  for (const uploadItem of responseData) {
    // Find the corresponding file
    const fileIndex = uploadItem.index;
    const filePath = mediaFiles[fileIndex];

    if (!filePath) {
      console.warn(`No file found for index ${fileIndex}`);
      continue;
    }

    // Read file content
    const fileContent = fs.readFileSync(filePath);

    // Upload to S3 using PUT request
    const uploadResponse = await axios.put(
      uploadItem.uploadUrl,
      fileContent,
      {
        headers: {
          'Content-Type': uploadItem.mime
        },
        timeout: 30000
      }
    );

    if (uploadResponse.status !== 200 && uploadResponse.status !== 204) {
      throw new Error(
        `Failed to upload file ${fileIndex} to S3: ${uploadResponse.status} - ${JSON.stringify(uploadResponse.data)}`
      );
    }

    // Prepare media info for chat message
    const mediaInfo = {
      url: uploadItem.postingUrl,
      mime: uploadItem.mime,
      isExplicit: isExplicit,
      aspectRatio: "", // May need to be calculated from image/video dimensions
      thumbnailUrl: "" // May be provided for videos, empty for images
    };

    postingUrls.push(mediaInfo);
  }

  return postingUrls;
}

