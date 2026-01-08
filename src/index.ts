/**
 * Rave SDK for Node.js
 * TypeScript/Node.js SDK for Rave app - WebSocket bot library
 */

// API Client
export { RaveAPIClient } from './api/client';

// WebSocket
export { RaveWebSocketClient } from './websocket/client';
export { ProtooRequest, ProtooNotification, ProtooResponse } from './websocket/protoo';

// Bot
export { RaveBot } from './bot/bot';
export { BotManager, BotState, BotInfo } from './bot/manager';
export { CommandContext } from './bot/context';

// Models
export { MeshModel, MeshStateModel } from './models/mesh';
export { UserModel } from './models/user';
export { StateMessageModel, UserStateModel, VoteModel } from './models/state';

// Utils
export {
  setDefaultApiClient,
  getDefaultApiClient,
  getVideoId,
  voteVideo,
  getMeshInfo,
  getFriendships,
  getUsersList,
  getMeshes,
  getInvitedMeshes,
  leaveMesh,
  uploadMedia
} from './utils/helpers';

// YouTube Search
export { searchAndGetVideoData } from './utils/youtube_search';
export type { VideoData } from './utils/youtube_search';

// Truth/Dare
export { getTruth, getDare } from './utils/truth_dare';
export type { Rating, TruthDareResponse } from './utils/truth_dare';

// Cloudflare AI
export {
  addUserMessage,
  getResponse,
  clearThread,
  setSystemPrompt,
  getSystemPrompt
} from './utils/cloudflare_ai';

// Auth
export { RaveLogin } from './auth/login';
export type { LoginResult } from './auth/login';
export {
  loadCredentials,
  saveCredentials,
  deleteCredentials
} from './auth/credentials';
export type { Credentials } from './auth/credentials';

// Types
export type { MessageInfo, UserInfo, CommandHandler, EventHandler } from './bot/bot';

// Process Management
export { ProcessManager } from './process/manager';
export { ProcessMonitor } from './process/monitor';
export { MeshBlocklist } from './process/blocklist';
export type { 
  ProcessInfo, 
  ProcessState, 
  ProcessManagerConfig, 
  MeshProcessConfig, 
  WorkerStatus,
  BlockedMesh,
  BotStatus as ProcessBotStatus
} from './process/types';

// Database
export { connectDatabase, disconnectDatabase, getDatabase, DatabaseConnection } from './database/connection';
export type { DatabaseConfig } from './database/connection';
export type { 
  CredentialsDocument, 
  AdminUserDocument, 
  CommandPermissionDocument,
  CredentialsData
} from './database/models';
export { credentialsRepo, adminRepo, permissionRepo } from './database/repositories';
export { 
  syncCredentialsToMongoDB, 
  syncCredentialsFromMongoDB, 
  ensureCredentialsSync,
  updateCredentials
} from './auth/sync';

// Permissions
export { PermissionManager, permissionManager } from './bot/permissions';

// Worker
export { MeshWorker } from './bot/worker';

