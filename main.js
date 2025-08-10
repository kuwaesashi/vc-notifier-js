// Discord.js の必要なクラス・定数をインポート（Deno環境対応）
import { Client, GatewayIntentBits, Partials, EmbedBuilder } from "npm:discord.js@14.14.1";

// 起動時のクラッシュログを拾う
addEventListener("unhandledrejection", (e) => {
  console.error("[unhandledrejection]", e.reason ?? e);
});
addEventListener("error", (e) => {
  console.error("[error]", e.message ?? e);
});

// 環境変数からトークン取得
const TOKEN = Deno.env.get("DISCORD_TOKEN");

// BOTの設定
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,            // サーバー（ギルド）情報の取得
    GatewayIntentBits.GuildVoiceStates,  // VCの入退室イベントを受け取る
    GatewayIntentBits.GuildMembers,       // メンバー情報を取得（displayName用）
    GatewayIntentBits.GuildMessages, // ★追加：履歴取得/削除に必要
  ],
  partials: [Partials.Channel],          // チャンネル情報の一部欠損に対応するための設定
});

// VC名 → 対応するテキストチャンネル名の対応表
// チャンネル名をキーにして送信先を判定
const VC_TO_TEXT = {
  "作業中": "通話募集（自動）",
  "共通相互作業部屋": "共通相互通話募集（自動）"
};

// === 全削除（確実版）：14日以内は bulkDelete、超過分は個別削除＋ページング ===
async function purgeAllMessages(ch) {
  const TWO_WEEKS = 14 * 24 * 60 * 60 * 1000;
  let before = undefined; // ページング用カーソル

  while (true) {
    const batch = await ch.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
    if (batch.size === 0) break;

    const now = Date.now();
    const younger = batch.filter(m => (now - m.createdTimestamp) < TWO_WEEKS);
    const older   = batch.filter(m => (now - m.createdTimestamp) >= TWO_WEEKS);

    if (younger.size > 0) {
      await ch.bulkDelete(younger, true).catch(() => {});
    }
    for (const [, msg] of older) {
      await msg.delete().catch(() => {});
      await new Promise(res => setTimeout(res, 150)); // レートリミット緩和
    }

    before = batch.last()?.id; // 次ページへ
  }
};

// 通知で送信したメッセージとテキストチャンネルIDを記録する Map
// Key: ${guildId}-${vcName}
// Value: { messageId, channelId }
const messageLog = new Map();

// BOT起動時に一度だけ呼ばれるイベント
client.on("ready", async () => {
  console.log(`BOT起動完了: ${client.user.tag}`);

  // 参加している全サーバーのチャンネル一覧を事前にキャッシュに読み込む
  for (const [, gRef] of client.guilds.cache) {
    const g = await gRef.fetch(); // 最新情報を取得
    await g.channels.fetch().catch(() => {}); // チャンネルキャッシュを更新
  }
});

// VCの入退室を検知するイベントハンドラ
client.on("voiceStateUpdate", async (oldState, newState) => {
  const member = newState.member || oldState.member;
  if (!member) return;

  // 入室処理
  if (oldState.channelId !== newState.channelId && newState.channel) {
    const vcName = newState.channel.name;

     console.log("[join] vc=%s members=%d map=%s",vcName, newState.channel.members.size, VC_TO_TEXT[vcName] ?? "NONE");

    // VC名が通知対象外なら無視
    if (!VC_TO_TEXT[vcName]) return;

    const memberCount = newState.channel.members.size;

    // 入室後のメンバーが1人だけ（つまり最初の入室者）のときのみ通知
    if (memberCount === 1) {
      // 対応するテキストチャンネルを取得（チャンネル名で取得）
      const textChannel = newState.guild.channels.cache.find(c => c.name === VC_TO_TEXT[vcName]);

      console.log("[dest] textCh=%s", textChannel?.name ?? "NOT_FOUND");

      // チャンネルが存在し、テキストベースであれば通知を送信
      if (textChannel && textChannel.isTextBased()) {

        // ← 重複送信ガード
        try {
          const last = await textChannel.messages.fetch({ limit: 1 });
          const lastMsg = last.first();
          const justSentByMe = lastMsg
            && lastMsg.author?.id === client.user.id
            && lastMsg.createdTimestamp > Date.now() - 10_000; // 10秒以内
          if (justSentByMe) {
            console.log("[notify-skip] 最近Botが同種メッセージを送っているためスキップ");
            return;
          }
        } catch { /* 取得失敗は無視して続行 */ }
        
        try {
            const message = await textChannel.send(
              `**${member.displayName}** が「${vcName}」に入室しました！\nお時間合う方は作業ご一緒してください♪`
            );

            // 通知メッセージIDを記録（後で削除時に使う）
            messageLog.set(`${newState.guild.id}-${vcName}`, message.id);
             console.log("[sent] id=%s", message.id);
        } catch (e) {
              console.error("[send-error]", e);
        }
      }
    }
  }

  // 退室処理
  if (oldState.channelId && oldState.channelId !== newState.channelId) {
    const vcName = oldState.channel.name;

    // VC名が通知対象外なら無視
    if (!VC_TO_TEXT[vcName]) return;

    const memberCount = oldState.channel.members.size;

    // VCが空（誰もいなくなった）になった時の処理
    if (memberCount === 0) {
      // 対応するテキストチャンネルを名前から取得
      const textChannel = oldState.guild.channels.cache.find(c => c.name === VC_TO_TEXT[vcName]);

      // チャンネルが存在していて、テキスト送受信が可能な場合のみ処理
      if (textChannel && textChannel.isTextBased()) {
        console.log(`VC「${vcName}」が0人になったため、#${textChannel.name} を全削除します`);

        // 全メッセージ削除関数を呼び出し
        // 失敗した場合はエラー内容をログに出す
        await purgeAllMessages(textChannel)
          .catch(e => console.log("purge error:", e));
      }

      // 通知メッセージの記録が残っていると後で不要に参照されるため、ここでクリア
      messageLog.delete(`${oldState.guild.id}-${vcName}`);
    }
  }
});

// トークン未設定で落ちないように
if (!TOKEN) {
  console.error("[fatal] DISCORD_TOKEN is not set");
  // 落とさずに待機（cronやヘルスチェックは残す）
  // return; ← モジュールのトップレベルなら書かず、そのままにしてOK
}

// Botを起動（シングルトン＋リトライ＆強制アンロック対応）
const DEPLOY_ID = Deno.env.get("DENO_DEPLOYMENT_ID") ?? crypto.randomUUID();
const kv = await Deno.openKv();
// ← 他プロジェクトと被らないように末尾を固有化しておくのが吉（例: "main"）
const LOCK_KEY = ["singleton", "voice-bot", "main"];

const FORCE_UNLOCK = Deno.env.get("FORCE_UNLOCK") === "1"; // 一時的な強制解除フラグ
let renewTimer = null;

async function tryAcquireAndStart(retryCount = 0) {
  try {
    // 既存ロック状況を確認
    const existing = await kv.get(LOCK_KEY);
    if (existing.value) {
      const age = Date.now() - (existing.value.ts ?? 0);
      const holder = existing.value.id ?? "unknown";
      console.log("[singleton] lock owner=%s age=%dms", holder, age);

      // 強制解除が指定されている or ロックが古い → 解除
      if (FORCE_UNLOCK || age > 90_000) {
        console.warn("[singleton] %s. Clearing lock.",
          FORCE_UNLOCK ? "FORCE_UNLOCK set" : `stale lock (age=${age}ms)`);
        await kv.delete(LOCK_KEY);
      }
    }
  } catch (e) {
    console.error("[singleton] precheck error", e);
  }

  // 原子的にロック取得
  const tx = await kv.atomic()
    .check({ key: LOCK_KEY, versionstamp: null })
    .set(LOCK_KEY, { id: DEPLOY_ID, ts: Date.now() }, { expireIn: 60_000 })
    .commit();

  if (tx.ok) {
    console.log("[singleton] acquired, starting bot", DEPLOY_ID);

    // ロック延長（cronはトップレベル限定なので setInterval で）
    if (renewTimer) clearInterval(renewTimer);
    renewTimer = setInterval(async () => {
      try {
        await kv.set(LOCK_KEY, { id: DEPLOY_ID, ts: Date.now() }, { expireIn: 60_000 });
      } catch (e) {
        console.error("[singleton-renew error]", e);
      }
    }, 30_000);

    try {
      await client.login(TOKEN);
    } catch (e) {
      console.error("[login error]", e);
    }
  } else {
    // 取れなかった → 再試行（60秒経過後は一度だけ強制解除を試す）
    if (retryCount === 4 && !FORCE_UNLOCK) {
      console.warn("[singleton] still not acquired after 60s. Next retry will force unlock.");
      Deno.env.set?.("FORCE_UNLOCK", "1"); // デプロイ中のみ有効な疑似フラグ
    }
    console.log("[singleton] lock not acquired. retry in 15s");
    setTimeout(() => tryAcquireAndStart(retryCount + 1), 15_000);
  }
}

// 起動トリガ
tryAcquireAndStart();

// 24時間稼働ログ（トップレベルの cron はOK）
Deno.cron("Continuous Request", "*/2 * * * *", () => {
  console.log("running...");
});

// ヘルスチェック（200 OKを返す）
Deno.serve(() => new Response("ok"));



