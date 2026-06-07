# Telegram Bot Extension for pi

Bridge Telegram messages to pi and send responses back — all with zero external dependencies (uses built-in `fetch()`).

## Setup

### 1. Create a Telegram Bot

1. Open Telegram and search for [@BotFather](https://t.me/BotFather)
2. Send `/newbot` and follow the prompts
3. Copy the token you receive (format: `123456789:ABCdefGHIjklmNOPqrstUVwxyz-1234567890`)

### 2. Set Environment Variable

```bash
export TELEGRAM_BOT_TOKEN="your-token-here"
```

Optionally restrict to specific Telegram usernames:

```bash
export TELEGRAM_ALLOWED_USERS="yourusername,friendusername"
```

### 3. Run with pi

```bash
# From the workspace directory
pi -e ./telegram-bot

# Or install globally for auto-discovery:
mkdir -p ~/.pi/agent/extensions/telegram-bot
cp -r * ~/.pi/agent/extensions/telegram-bot/
pi
```

## Usage

### Inside pi

```
/telegram status   - Check if the bot is running
/telegram start    - Start the bot
/telegram stop     - Stop the bot
```

### In Telegram

- Send any message to your bot — it will be forwarded to pi
- The response will be sent back to you
- Messages are prefixed with `[Telegram - username in chat]` in pi's session

## Features

- ✅ Zero dependencies — uses built-in `fetch()` and `AbortController`
- ✅ Long-polling for updates (no webhook setup needed)
- ✅ Auto-starts on session start if `TELEGRAM_BOT_TOKEN` is set
- ✅ User authorization via `TELEGRAM_ALLOWED_USERS`
- ✅ Markdown-formatting support
- ✅ Long messages are automatically split (Telegram's 4096 char limit)
- ✅ Clean shutdown on session end
- ✅ `/start` command handling

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `TELEGRAM_BOT_TOKEN` | Yes | Your Telegram bot token from @BotFather |
| `TELEGRAM_ALLOWED_USERS` | No | Comma-separated list of allowed Telegram @usernames (empty = allow all) |
