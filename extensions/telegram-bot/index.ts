/**
 * Telegram Bot Extension for pi
 *
 * Bridges Telegram messages to pi and sends responses back.
 * Runs entirely with built-in fetch() - no external dependencies needed.
 *
 * Setup:
 *   1. Create a Telegram bot via @BotFather (https://t.me/BotFather)
 *   2. Set the environment variable:
 *      export TELEGRAM_BOT_TOKEN="your-bot-token"
 *   3. (Optional) Restrict to specific users:
 *      export TELEGRAM_ALLOWED_USERS="user1,user2"  (Telegram @usernames)
 *   4. Load the extension:
 *      pi -e ./telegram-bot
 *
 *    Or install globally:
 *      mkdir -p ~/.pi/agent/extensions/telegram-bot
 *      cp -r * ~/.pi/agent/extensions/telegram-bot/
 *
 * Commands:
 *   /telegram start   - Start the Telegram bot
 *   /telegram stop    - Stop the Telegram bot
 *   /telegram status  - Check if the bot is running
 *
 * The bot will start automatically on session start if TELEGRAM_BOT_TOKEN is set.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TelegramUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  username?: string;
  language_code?: string;
}

interface TelegramChat {
  id: number;
  type: string;
  title?: string;
  username?: string;
  first_name?: string;
}

interface TelegramMessage {
  message_id: number;
  chat: TelegramChat;
  from?: TelegramUser;
  text?: string;
  date: number;
}

interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}

// ---------------------------------------------------------------------------
// Simple Telegram Bot API client (uses fetch, no external deps)
// ---------------------------------------------------------------------------

class TelegramBot {
  private token: string;
  private pollTimeout: ReturnType<typeof setTimeout> | null = null;
  private polling = false;
  private offset = 0;
  private onMessage: ((msg: TelegramMessage) => void) | null = null;
  private baseUrl: string;
  private botInfo: TelegramUser | null = null;

  constructor(token: string) {
    this.token = token;
    this.baseUrl = `https://api.telegram.org/bot${token}`;
  }

  setOnMessage(handler: (msg: TelegramMessage) => void) {
    this.onMessage = handler;
  }

  async start(): Promise<boolean> {
    this.botInfo = await this.callApi("getMe");
    if (!this.botInfo) return false;

    this.polling = true;
    this.offset = 0;
    this.pollLoop();
    return true;
  }

  stop() {
    this.polling = false;
    if (this.pollTimeout) {
      clearTimeout(this.pollTimeout);
      this.pollTimeout = null;
    }
  }

  async sendMessage(chatId: number, text: string): Promise<boolean> {
    // Telegram max message length is 4096 characters
    const MAX_LEN = 4000;
    if (text.length <= MAX_LEN) {
      return this._send(chatId, text);
    }

    // Split into multiple messages
    const parts = this.splitText(text, MAX_LEN);
    for (const part of parts) {
      const ok = await this._send(chatId, part);
      if (!ok) return false;
    }
    return true;
  }

  isRunning(): boolean {
    return this.polling;
  }

  getBotInfo(): TelegramUser | null {
    return this.botInfo;
  }

  // -----------------------------------------------------------------------
  // Private
  // -----------------------------------------------------------------------

  private async callApi(method: string, body?: Record<string, unknown>): Promise<any> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);

      const response = await fetch(`${this.baseUrl}/${method}`, {
        method: body ? "POST" : "GET",
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      clearTimeout(timeout);
      const data = await response.json() as { ok: boolean; result?: any };
      return data.ok ? data.result : null;
    } catch {
      return null;
    }
  }

  private async _send(chatId: number, text: string): Promise<boolean> {
    // Escape markdown special characters to avoid parse errors
    const safe = this.escapeMarkdown(text);
    const result = await this.callApi("sendMessage", {
      chat_id: chatId,
      text: safe,
      parse_mode: "MarkdownV2",
    });
    if (result) return true;

    // Retry without markdown if markdown parsing fails
    const result2 = await this.callApi("sendMessage", {
      chat_id: chatId,
      text: text.substring(0, 4096),
    });
    return !!result2;
  }

  private escapeMarkdown(text: string): string {
    // MarkdownV2 requires escaping: _ * [ ] ( ) ~ ` > # + - = | { } . !
    return text.replace(/[_*\[\]()~`>#+\-=|{}.!]/g, "\\$&");
  }

  private splitText(text: string, maxLen: number): string[] {
    const parts: string[] = [];
    let remaining = text;

    while (remaining.length > 0) {
      if (remaining.length <= maxLen) {
        parts.push(remaining);
        break;
      }

      // Try to split at a newline
      let splitAt = remaining.lastIndexOf("\n", maxLen);
      if (splitAt <= 0) {
        splitAt = remaining.lastIndexOf(" ", maxLen);
      }
      if (splitAt <= 0) {
        splitAt = maxLen;
      }

      parts.push(remaining.substring(0, splitAt));
      remaining = remaining.substring(splitAt).trim();
    }

    return parts;
  }

  private async pollLoop() {
    while (this.polling) {
      try {
        const result = await this.callApi("getUpdates", {
          offset: this.offset,
          timeout: 30,
          allowed_updates: ["message"],
        });

        if (result && Array.isArray(result)) {
          for (const update of result as TelegramUpdate[]) {
            this.offset = update.update_id + 1;
            if (update.message && this.onMessage) {
              this.onMessage(update.message);
            }
          }
        }
      } catch {
        if (!this.polling) break;
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Extension State
// ---------------------------------------------------------------------------

let bot: TelegramBot | null = null;
let pendingChatId: number | null = null;
const TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const ALLOWED_USERS = (process.env.TELEGRAM_ALLOWED_USERS || "")
  .split(",")
  .map((u) => u.trim().toLowerCase().replace(/^@/, ""))
  .filter(Boolean);

// ---------------------------------------------------------------------------
// Helper: extract text from pi message content
// ---------------------------------------------------------------------------

function extractTextFromContent(content: any): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((block: any) => {
        if (block.type === "text") return block.text;
        if (block.type === "thinking") return `[Thinking: ${block.thinking}]`;
        if (block.type === "toolCall") {
          return `[Tool Call: ${block.name}(${JSON.stringify(block.arguments)})]`;
        }
        return "";
      })
      .join("\n")
      .trim();
  }
  return "";
}

// ---------------------------------------------------------------------------
// Helper: check if a user is authorized
// ---------------------------------------------------------------------------

function isAuthorized(msg: TelegramMessage): boolean {
  if (ALLOWED_USERS.length === 0) return true; // Allow all if not configured
  const username = msg.from?.username?.toLowerCase() || "";
  return ALLOWED_USERS.includes(username);
}

// ---------------------------------------------------------------------------
// Extension Factory
// ---------------------------------------------------------------------------

export default function (pi: ExtensionAPI) {
  // -----------------------------------------------------------------------
  // /telegram command
  // -----------------------------------------------------------------------

  pi.registerCommand("telegram", {
    description: "Manage the Telegram bot. Usage: /telegram start|stop|status",
    handler: async (args, ctx) => {
      const cmd = args.trim().toLowerCase();

      if (cmd === "start") {
        await startBot(ctx);
      } else if (cmd === "stop") {
        await stopBot(ctx);
      } else if (cmd === "status") {
        showStatus(ctx);
      } else {
        ctx.ui.notify(
          "Usage: /telegram start|stop|status",
          "warning"
        );
      }
    },
  });

  // -----------------------------------------------------------------------
  // Listen for assistant responses to forward to Telegram
  // -----------------------------------------------------------------------

  pi.on("message_end", async (event, _ctx) => {
    if (!bot || !bot.isRunning()) return;
    if (!pendingChatId) return;
    if (event.message.role !== "assistant") return;

    const text = extractTextFromContent(event.message.content);
    if (!text) return;

    const chatId = pendingChatId;
    pendingChatId = null;

    await bot.sendMessage(chatId, text);
  });

  // -----------------------------------------------------------------------
  // Auto-start on session start if token is available
  // -----------------------------------------------------------------------

  pi.on("session_start", async (_event, ctx) => {
    if (TOKEN && !bot) {
      await startBot(ctx);
    }
  });

  // Cleanup on shutdown
  pi.on("session_shutdown", async () => {
    if (bot) {
      bot.stop();
      bot = null;
    }
    pendingChatId = null;
  });

  // -----------------------------------------------------------------------
  // Bot Control
  // -----------------------------------------------------------------------

  async function startBot(ctx: any) {
    if (bot && bot.isRunning()) {
      ctx.ui.notify("Telegram bot is already running", "info");
      return;
    }

    if (!TOKEN) {
      ctx.ui.notify(
        "TELEGRAM_BOT_TOKEN not set.\n\n" +
        "1. Go to @BotFather on Telegram and create a new bot\n" +
        "2. Copy the token (looks like: 123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11)\n" +
        "3. Set it: export TELEGRAM_BOT_TOKEN='your-token'\n" +
        "4. Restart pi or run /telegram start",
        "error"
      );
      return;
    }

    ctx.ui.notify("Starting Telegram bot...", "info");

    bot = new TelegramBot(TOKEN);

    bot.setOnMessage((msg) => {
      // Handle /start command
      if (msg.text === "/start") {
        bot?.sendMessage(
          msg.chat.id,
          "Hello! I'm connected to pi. Send me any message and I'll forward it.\n\n" +
          "Note: Responses go to the terminal where pi is running."
        );
        return;
      }

      // Skip other commands (they're for the bot, not pi)
      if (msg.text?.startsWith("/")) return;

      // Check authorization
      if (!isAuthorized(msg)) {
        bot?.sendMessage(msg.chat.id, "Sorry, you're not authorized to use this bot.");
        return;
      }

      // Store chat info for response routing
      pendingChatId = msg.chat.id;

      // Send the message to pi's agent
      const sender = msg.from?.username || msg.from?.first_name || "Telegram User";
      const chatTitle = msg.chat.title || msg.chat.username || `chat ${msg.chat.id}`;
      const prefixed = `[Telegram - ${sender} in ${chatTitle}] ${msg.text}`;

      try {
        if (pi) {
          pi.sendUserMessage(prefixed);
        }
      } catch {
        // If agent is busy, try with followUp delivery
        try {
          pi.sendUserMessage(prefixed, { deliverAs: "followUp" });
        } catch {
          // Ignore send failures
        }
      }
    });

    const started = await bot.start();

    if (started) {
      const info = bot.getBotInfo();
      const botUsername = info?.username ? `@${info.username}` : "Bot";
      ctx.ui.notify(
        `Telegram bot ${botUsername} is RUNNING.\n` +
        `Send it a message to chat with pi!`,
        "success"
      );
    } else {
      ctx.ui.notify(
        "Failed to start Telegram bot. Check your TELEGRAM_BOT_TOKEN.\n" +
        "Expected format: 123456789:ABCdefGHIjklmNOPqrstUVwxyz-1234567890",
        "error"
      );
      bot = null;
    }
  }

  async function stopBot(ctx: any) {
    if (!bot || !bot.isRunning()) {
      ctx.ui.notify("Telegram bot is not running", "info");
      return;
    }

    bot.stop();
    bot = null;
    pendingChatId = null;
    ctx.ui.notify("Telegram bot stopped", "info");
  }

  function showStatus(ctx: any) {
    if (bot && bot.isRunning()) {
      const info = bot.getBotInfo();
      const botUsername = info?.username ? `@${info.username}` : "Unknown";
      ctx.ui.notify(
        `Telegram bot: RUNNING\n` +
        `Bot: ${botUsername}\n` +
        `Token: ${TOKEN.slice(0, 12)}...${TOKEN.slice(-4)}`,
        "info"
      );
      if (ALLOWED_USERS.length > 0) {
        ctx.ui.notify(`Allowed users: @${ALLOWED_USERS.join(", @")}`, "info");
      }
    } else if (TOKEN) {
      ctx.ui.notify(
        "Telegram bot: STOPPED\n" +
        `Token: ${TOKEN.slice(0, 12)}...${TOKEN.slice(-4)}\n` +
        "Use /telegram start to start it.",
        "info"
      );
    } else {
      ctx.ui.notify(
        "Telegram bot: NOT CONFIGURED\n\n" +
        "To set up:\n" +
        "1. Open Telegram and search for @BotFather\n" +
        "2. Send /newbot and follow the prompts\n" +
        "3. Copy the token you receive\n" +
        "4. Run: export TELEGRAM_BOT_TOKEN='your-token'\n" +
        "5. Run: /telegram start",
        "warning"
      );
    }
  }
}
