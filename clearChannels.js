import { Client, GatewayIntentBits, Partials, TextChannel, Collection, Message } from "npm:discord.js@14.14.1";

const TOKEN = Deno.env.get("DISCORD_TOKEN");

// 消したいチャンネル名一覧
const TARGET_CHANNEL_NAMES = [
  "通話募集（自動）",
  "共通相互通話募集（自動）"
];

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
  partials: [Partials.Channel],
});

// 使い回しの全削除関数（main と同じ）
async function purgeAllMessages(ch: TextChannel) {
  const TWO_WEEKS = 14 * 24 * 60 * 60 * 1000;
  let before: string | undefined = undefined;
  while (true) {
    const batch: Collection<string, Message> = await ch.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
    if (batch.size === 0) break;
    const now = Date.now();
    const younger = batch.filter(m => (now - m.createdTimestamp) < TWO_WEEKS);
    const older   = batch.filter(m => (now - m.createdTimestamp) >= TWO_WEEKS);
    if (younger.size > 0) await ch.bulkDelete(younger, true).catch(()=>{});
    for (const [, msg] of older) { await msg.delete().catch(()=>{}); await new Promise(r=>setTimeout(r,150)); }
    before = batch.last()?.id;
  }
}

client.on("ready", async () => {
  console.log(`🧹 clear worker ready: ${client.user?.tag}`);

  // 起動時に一度キャッシュを埋める
  for (const [, gRef] of client.guilds.cache) {
    const guild = await gRef.fetch();
    await guild.channels.fetch().catch(()=>{});
  }

  // 毎日 JST 4:00 に実行（UTC 19:00）
  Deno.cron("Nightly Purge 4AM JST", "0 19 * * *", async () => {
    console.log("[cron] 4AM JST purge start");
    for (const [, gRef] of client.guilds.cache) {
      const guild = await gRef.fetch();
      await guild.channels.fetch().catch(()=>{});
      for (const ch of guild.channels.cache.values()) {
        if (TARGET_CHANNEL_NAMES.includes(ch.name) && ch.isTextBased()) {
          console.log(`[cron] purge #${ch.name}`);
          await purgeAllMessages(ch as TextChannel).catch(e => console.log("purge error:", e));
        }
      }
    }
    console.log("[cron] purge end");
  });

  // keep alive (ログ)
  Deno.cron("heartbeat", "*/5 * * * *", () => console.log("clear worker running..."));
});

client.login(TOKEN);
