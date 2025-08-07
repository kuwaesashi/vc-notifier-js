// Discord.js の必要なクラス・定数をインポート（Deno環境対応）
import { Client, GatewayIntentBits, Partials, EmbedBuilder } from "npm:discord.js@14.14.1";

// 環境変数からトークン取得
const TOKEN = Deno.env.get("DISCORD_TOKEN");

// BOTの設定
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,            // サーバー（ギルド）情報の取得
    GatewayIntentBits.GuildVoiceStates,  // VCの入退室イベントを受け取る
    GatewayIntentBits.GuildMembers       // メンバー情報を取得（displayName用）
  ],
  partials: [Partials.Channel],          // チャンネル情報の一部欠損に対応するための設定
});

// VC名 → 対応するテキストチャンネル名の対応表
// チャンネル名をキーにして送信先を判定
const VC_TO_TEXT = {
  "作業中": "通話募集（自動）",
  "共通相互作業部屋": "共通相互通話募集（自動）"
};

// 通知で送信したメッセージとテキストチャンネルIDを記録する Map
// Key: ${guildId}-${vcName}
// Value: { messageId, channelId }
const messageLog = new Map();

// BOT起動時に一度だけ呼ばれるイベント
client.on("ready", () => {
  console.log(`BOT起動完了: ${client.user.tag}`);
});

// VCの入退室を検知するイベントハンドラ
client.on("voiceStateUpdate", async (oldState, newState) => {
  const member = newState.member || oldState.member;
  if (!member) return;

  // 入室処理
  if (oldState.channelId !== newState.channelId && newState.channel) {
    const vcName = newState.channel.name;

    // VC名が通知対象外なら無視
    if (!VC_TO_TEXT[vcName]) return;

    const memberCount = newState.channel.members.size;

    // 入室後のメンバーが1人だけ（つまり最初の入室者）のときのみ通知
    if (memberCount === 1) {
      // 対応するテキストチャンネルを取得（チャンネル名で取得）
      const textChannel = newState.guild.channels.cache.find(c => c.name === VC_TO_TEXT[vcName]);

      // チャンネルが存在し、テキストベースであれば通知を送信
      if (textChannel && textChannel.isTextBased()) {
        const message = await textChannel.send(
          `**${member.displayName}** が「${vcName}」に入室しました！\nお時間合う方は作業ご一緒してください♪`
        );

        // 通知メッセージIDとチャンネルIDを記録（後で削除時に使う）
        messageLog.set(`${newState.guild.id}-${vcName}`, {
          messageId: message.id,
          channelId: textChannel.id
        });
      }
    }
  }

  // 退室処理
  if (oldState.channelId && oldState.channelId !== newState.channelId) {
    const vcName = oldState.channel.name;

    // VC名が通知対象外なら無視
    if (!VC_TO_TEXT[vcName]) return;

    const memberCount = oldState.channel.members.size;

    // VCが空（誰もいなくなった）になった時
    if (memberCount === 0) {
      const logKey = `${oldState.guild.id}-${vcName}`;
      const logData = messageLog.get(logKey);

      // 該当VCの通知メッセージが記録されていた場合
      if (logData) {
        const { messageId, channelId } = logData;

        // 修正点：チャンネル名ではなく、保存しておいたチャンネルIDからチャンネル取得
        const textChannel = oldState.guild.channels.cache.get(channelId);

        if (textChannel && textChannel.isTextBased()) {
          try {
            const msg = await textChannel.messages.fetch(messageId);
            await msg.delete(); // 通知メッセージを削除
          } catch {
            console.log("⚠ 通知メッセージ削除失敗（すでに削除済みの可能性）");
          }
        }

        // 通知ログから削除
        messageLog.delete(`${oldState.guild.id}-${vcName}`);
      }
    }
  }
});

// Botを起動
client.login(TOKEN);

// 24時間稼働
Deno.cron("Continuous Request", "*/2 * * * *", () => {
    console.log("running...");
});

