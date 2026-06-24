# 💰 Telegram Finance Bot — Setup Guide

## 📋 Requirements
- Node.js v16+ installed
- A Telegram Bot Token (from @BotFather)

---

## 🚀 Installation

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Set your Bot Token** (choose one method):

   **Option A — Environment variable (recommended):**
   ```bash
   export BOT_TOKEN=your_token_here
   node bot.js
   ```

   **Option B — Edit bot.js directly:**
   Open `bot.js` and replace line:
   ```js
   const TOKEN = process.env.BOT_TOKEN || 'YOUR_BOT_TOKEN_HERE';
   ```
   with your actual token.

3. **Run the bot:**
   ```bash
   node bot.js
   ```

---

## 👑 First Time Setup (Owner)
1. Open your bot in Telegram and send `/start`
2. You will automatically become the **owner/admin**
3. Use `/approve <userId>` to let others use the bot
4. Users can find their ID by sending `/myid` to the bot

---

## 🤖 Bot Commands

| Command | Description |
|---------|-------------|
| `/start` | Start the bot, first user becomes owner |
| `/myid` | Show your Telegram User ID |
| `/summary` | Full report with all totals |
| `/reset` | ⚠️ Clear all data (owner only) |
| `/admin` | Admin panel to manage users (owner only) |
| `/approve <userId>` | Approve a user (owner only) |
| `/revoke <userId>` | Remove a user's access (owner only) |
| `/help` | Show help |

---

## 💬 Message Commands

| Message | Description |
|---------|-------------|
| `+100` | Add 100 to deposits |
| `-100` | Add 100 to payouts |
| `rate 60` | Set exchange rate to 60 (calculates amount/60) |
| `fee 10` | Set fee to 10% (deducts 10% from total) |
| `withdraw 100` | Deduct 100 from Total Received |
| Reply to any image with `+100` | Same as above but replies to that message |

---

## 📊 Summary Report Format

```
📊 SUMMARY REPORT
🕐 Bangkok Time: 24/06/2026, 15:30:00

📥 Today's Deposits (3 transactions)
  • [time] @user1 ➕ 300.00
  • [time] @user2 ➕ 500.00

📤 Today's Payouts (1 transactions)
  • [time] @user1 ➖ 100.00

💰 Total Deposits:          800.00
💸 Total Payouts:           100.00

⚙️ Exchange Rate:           60
📉 Transaction Fee:         10%

📌 Amount Total:            800.00
📌 Amount After Deduct Fee: 720.00
📌 Total Received:          12.00
```

---

## 🔄 How Calculations Work

1. **Exchange Rate**: `Total Received = Amount After Fee ÷ Exchange Rate`
   - Example: rate 60 → 720 ÷ 60 = 12

2. **Fee**: Deducted from total deposits
   - Example: fee 10 → 800 × 10% = 80 deducted → 720 remaining

3. **Withdraw**: Deducted from Total Received
   - Example: withdraw 5 → 12 - 5 = 7 remaining

---

## 📦 Run as Background Service (optional)
```bash
npm install -g pm2
pm2 start bot.js --name finance-bot
pm2 save
pm2 startup
```
