import { Client, GatewayIntentBits } from "npm:discord.js@14.14.1";

const TOKEN = Deno.env.get("DISCORD_TOKEN");

// 消したいチャンネル名一覧
const TARGET_CHANNEL_NAMES = [
  "通話募集（自動）",
  "共通相互通話募集（自動）"
];

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages]
});

client.once("ready", async () => {
  console.log("🧹 定期削除開始");

  for (const guild of client.guilds.cache.values()) {
    for (const [channelId, channel] of guild.channels.cache) {
      if (
        TARGET_CHANNEL_NAMES.includes(channel.name) &&
        channel.isTextBased()
      ) {
        try {
          const messages = await channel.messages.fetch({ limit: 100 });
          for (const msg of messages.values()) {
            await msg.delete();
          }
          console.log(`✅ ${channel.name} のメッセージを削除しました`);
        } catch (err) {
          console.error(`⚠ ${channel.name} の削除に失敗しました`, err);
        }
      }
    }
  }

  client.destroy(); // 処理後にログアウト
});

client.login(TOKEN);