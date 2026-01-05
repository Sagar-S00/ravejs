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
export { BotManager, BotState, BotInfo, BotStatus } from './bot/manager';
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

// Types
export type { MessageInfo, UserInfo, CommandHandler, EventHandler } from './bot/bot';

