import { Client, GatewayIntentBits, Partials, EmbedBuilder } from "npm:discord.js@14.14.1";

// 環境変数からトークン取得
const TOKEN = Deno.env.get("DISCORD_TOKEN");

// BOTの設定
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMembers
  ],
  partials: [Partials.Channel],
});

const VC_TO_TEXT = {
  "作業中": "通話募集（自動）",
  "共通相互作業部屋": "共通相互通話募集（自動）"
};

const messageLog = new Map();

client.on("ready", () => {
  console.log(`BOT起動完了: ${client.user.tag}`);
});

client.on("voiceStateUpdate", async (oldState, newState) => {
  const member = newState.member || oldState.member;
  if (!member) return;

  // 入室処理
  if (oldState.channelId !== newState.channelId && newState.channel) {
    const vcName = newState.channel.name;
    if (!VC_TO_TEXT[vcName]) return;

    const memberCount = newState.channel.members.size;
    if (memberCount === 1) {
      const textChannel = newState.guild.channels.cache.find(c => c.name === VC_TO_TEXT[vcName]);
      if (textChannel && textChannel.isTextBased()) {
        const message = await textChannel.send(
           **${member.displayName}** が「${vcName}」に入室しました！\nお時間合う方は作業ご一緒してください♪
        );
        messageLog.set(`${newState.guild.id}-${vcName}`, message.id);
      }
    }
  }

  // 退室処理
  if (oldState.channelId && oldState.channelId !== newState.channelId) {
    const vcName = oldState.channel.name;
    if (!VC_TO_TEXT[vcName]) return;

    const memberCount = oldState.channel.members.size;
    if (memberCount === 0) {
      const messageId = messageLog.get(`${oldState.guild.id}-${vcName}`);
      if (messageId) {
        const textChannel = oldState.guild.channels.cache.find(c => c.name === VC_TO_TEXT[vcName]);
        if (textChannel && textChannel.isTextBased()) {
          try {
            const msg = await textChannel.messages.fetch(messageId);
            await msg.delete();
          } catch {
            console.log("⚠ 通知メッセージ削除失敗（既に削除済み）");
          }
        }
        messageLog.delete(`${oldState.guild.id}-${vcName}`);
      }
    }
  }
});

client.login(TOKEN);