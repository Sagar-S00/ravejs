/**
 * Multi-Mesh Bot Manager Example
 * Demonstrates connecting to all invited meshes and managing multiple bot instances
 */

import { BotManager, RaveAPIClient, setDefaultApiClient } from '../src/index';

async function main() {
  const deviceId = "63666d612ee84efc80d1b227c593f9e9";
  const authToken = "c5108b99a95c9316e37579e1c6f468be";
  const peerId = "122629233_63666d612ee84efc80d1b227c593f9e9";

  // Create API client
  const apiClient = new RaveAPIClient("https://api.red.wemesh.ca", authToken);
  setDefaultApiClient(apiClient);

  // Create bot manager
  const manager = new BotManager(
    deviceId,
    peerId,
    authToken,
    ["!", "?", "~", "+"], // Multiple command prefixes
    true, // debug mode
    apiClient,
    10, // max retries
    1.0, // initial backoff
    60.0, // max backoff
    60.0, // discovery interval
    "invited" // mesh mode: "invited" or "all"
  );

  // Register all commands from bot_commands.ts
  const { registerCommands } = await import('./bot_commands');
  registerCommands(manager);

  // Register global events (applied to all bots)
  manager.event("on_user_join", async (bot, userInfo) => {
    const name = userInfo.displayName || `User ${userInfo.id}`;
    await bot.sendMessage(`Welcome ${name} to the chat!`);
  });

  manager.event("on_connected", async (bot) => {
    console.log(`Bot connected to room ${bot.roomId}`);
  });

  manager.event("on_kicked", async () => {
    console.log("Bot was kicked from a room");
  });

  // Run the bot manager
  try {
    await manager.run(20, "en"); // limit: 20 meshes, lang: "en"
  } catch (error) {
    console.error("Manager error:", error);
  } finally {
    await manager.stop();
  }
}

main().catch(console.error);

