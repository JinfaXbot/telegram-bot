const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');

const TOKEN = process.env.BOT_TOKEN || '8517712618:AAHBwhZCk5kgjmSa_Dzs1-ypxnS5D6_vofM';
const DATA_FILE = './data.json';

// ─── KHQR CONFIG ──────────────────────────────────────────────────────────────
// Set your KHQR image path or URL below.
// You can use a local file path like './khqr.jpg' or a public image URL.
const KHQR_IMAGE = process.env.KHQR_IMAGE || './khqr.jpg';

// Your ABA/KHQR account name shown in confirmation messages
const KHQR_NAME = process.env.KHQR_NAME || 'KUN KHLINTON';
const KHQR_ACCOUNT = process.env.KHQR_ACCOUNT || '974 462 445';
const MERCHANT_ID  = process.env.MERCHANT_ID  || 'ABAPAYRW466401R';

// Subscription plans: [label, months, priceUSD]
const PLANS = [
  { id: '1m', label: '1 Month',  months: 1, price: 5  },
  { id: '3m', label: '3 Months', months: 3, price: 12 },
  { id: '6m', label: '6 Months', months: 6, price: 20 },
];

// Pending payments: userId → { planId, requestedAt }
const pendingPayments = {};

// ─── DATA ─────────────────────────────────────────────────────────────────────
function loadData() {
  if (!fs.existsSync(DATA_FILE)) return { chats: {}, admins: [], approvedUsers: {} };
  try {
    const d = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    // Migrate old array format to object format
    if (Array.isArray(d.approvedUsers)) {
      const obj = {};
      d.approvedUsers.forEach(id => { obj[id] = { expiry: null, username: String(id) }; });
      d.approvedUsers = obj;
    }
    return d;
  } catch { return { chats: {}, admins: [], approvedUsers: {} }; }
}
function saveData(data) { fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2)); }

let db = loadData();

function getChatState(chatId) {
  if (!db.chats[chatId]) {
    db.chats[chatId] = { exchangeRate: null, fee: null, deposits: [], payouts: [] };
  }
  return db.chats[chatId];
}

// ─── ACCESS CHECKS ────────────────────────────────────────────────────────────
function isOwner(userId) { return db.admins.includes(userId); }

function accessStatus(userId) {
  if (isOwner(userId)) return { ok: true };
  const user = db.approvedUsers[userId];
  if (!user) return { ok: false, reason: 'not_approved' };
  if (user.expiry && Date.now() > user.expiry) return { ok: false, reason: 'expired' };
  return { ok: true };
}

function isApproved(userId) { return accessStatus(userId).ok; }

// Find userId by username (with or without @)
function findUserIdByUsername(username) {
  const clean = username.replace(/^@/, '').toLowerCase();
  for (const [id, u] of Object.entries(db.approvedUsers)) {
    if ((u.username || '').toLowerCase() === clean) return parseInt(id);
  }
  return null;
}


// ─── HELPERS ──────────────────────────────────────────────────────────────────
function phnomPenhTime() {
  return new Date().toLocaleString('en-GB', {
    timeZone: 'Asia/Phnom_Penh',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

function formatNumber(n) {
  return Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatExpiry(ts) {
  if (!ts) return 'Never expires';
  return new Date(ts).toLocaleString('en-GB', {
    timeZone: 'Asia/Phnom_Penh',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function addMonths(months) {
  const d = new Date();
  d.setMonth(d.getMonth() + months);
  return d.getTime();
}

function send(bot, chatId, text, extra = {}) {
  return bot.sendMessage(chatId, text, { parse_mode: 'HTML', ...extra })
    .catch(() => bot.sendMessage(chatId, text.replace(/<[^>]*>/g, ''), extra));
}

function b(t) { return `<b>${t}</b>`; }
function c(t) { return `<code>${t}</code>`; }

// ─── SUMMARY ──────────────────────────────────────────────────────────────────
function buildSummary(state) {
  const exchangeRate = state.exchangeRate || 1;
  const feePercent = state.fee || 0;
  const totalDeposits = state.deposits.reduce((s, d) => s + d.amount, 0);
  const totalPayouts = state.payouts.reduce((s, d) => s + d.amount, 0);
  const feeAmount = totalDeposits * (feePercent / 100);
  const amountAfterFee = totalDeposits - feeAmount;
  const totalReceived = amountAfterFee / exchangeRate;

  const timeOnly = (t) => t.split(', ')[1] || t;

  const depositLines = state.deposits.length
    ? state.deposits.map(d => `• ${timeOnly(d.time)} @${d.username || d.userId} ➕ ${formatNumber(d.amount)}`).join('\n')
    : '  (none)';

  const payoutLines = state.payouts.length
    ? state.payouts.map(d => `• ${timeOnly(d.time)} @${d.username || d.userId} ➖ ${formatNumber(d.amount)}`).join('\n')
    : '  (none)';

  return [
    `📊 ${b('SUMMARY REPORT')}`,
    `🕐 Phnom Penh Time: ${phnomPenhTime()}`,
    `━━━━━━━━━━━━━━━━━`,
    `📥 ${b("Today's Deposits")} (${state.deposits.length} transactions)`,
    depositLines,
    `📤 ${b("Today's Payouts")} (${state.payouts.length} transactions)`,
    payoutLines,
    `━━━━━━━━━━━━━━━━━`,
    `💰 Total Deposits:          ${c(formatNumber(totalDeposits))}`,
    `💸 Total Payouts:           ${c(formatNumber(totalPayouts))}`,
    `⚙️ Exchange Rate:           ${c(String(exchangeRate))}`,
    `📉 Transaction Fee:         ${c(feePercent + '%')}`,
    `━━━━━━━━━━━━━━━━━`,
    `📌 Amount Total:            ${c(formatNumber(totalDeposits))}`,
    `📌 Amount After Deduct Fee: ${c(formatNumber(amountAfterFee))}`,
    `📌 Total Received:          ${c(formatNumber(totalReceived + USDT))}`,
  ].join('\n');
}

function helpText() {
  return [
    `${b('Available Commands:')}`,
    `➕ ${c('+100')} — Add deposit amount`,
    `➖ ${c('-100')} — Add payout amount`,
    `${c('rate 60')} — Set exchange rate`,
    `${c('fee 10')} — Set fee percentage (%)`,
    `${c('withdraw 100')} — Withdraw from total`,
    `${c('clear bill')} — Reset deposits &amp; payouts to 0`,
    `/subscribe — Buy/renew a subscription via KHQR`,
    `/summary — View full summary report`,
    `/reset — Clear all data (owner only)`,
    `/admin — Manage users (owner only)`,
    `/myid — Show your Telegram user ID`,
  ].join('\n');
}

// ─── BOT ──────────────────────────────────────────────────────────────────────
const bot = new TelegramBot(TOKEN, { polling: true });

bot.on('polling_error', (err) => console.error('Polling error:', err.message));
process.on('unhandledRejection', (err) => console.error('Unhandled rejection:', err.message));

// ─── CHECK EXPIRY & NOTIFY (runs every hour) ──────────────────────────────────
function checkExpiries() {
  const now = Date.now();
  const oneDayMs = 24 * 60 * 60 * 1000;
  Object.entries(db.approvedUsers).forEach(([userId, user]) => {
    if (!user.expiry) return;
    const remaining = user.expiry - now;
    // Notify 3 days before expiry (only once)
    if (remaining > 0 && remaining <= 3 * oneDayMs && !user.warned) {
      const days = Math.ceil(remaining / oneDayMs);
      send(bot, parseInt(userId),
        `⚠️ ${b('Your subscription expires in ' + days + ' day(s)!')}\n` +
        `Expiry: ${formatExpiry(user.expiry)}\n\n` +
        `Use /subscribe to renew your subscription.`
      );
      user.warned = true;
      saveData(db);
    }
    // Notify when already expired
    if (remaining <= 0 && !user.expiredNotified) {
      send(bot, parseInt(userId),
        `🔒 ${b('Your subscription has expired.')}\n\n` +
        `Use /subscribe to renew via KHQR payment.`
      );
      user.expiredNotified = true;
      saveData(db);
    }
  });
}
setInterval(checkExpiries, 60 * 60 * 1000); // every hour
checkExpiries(); // also run on startup

// ─── KHQR HELPERS ─────────────────────────────────────────────────────────────

function sendSubscribePlans(chatId, intro) {
  const planButtons = PLANS.map(p => ([{
    text: `${p.label} — $${p.price}`,
    callback_data: `plan_${p.id}`,
  }]));
  return bot.sendMessage(chatId, intro, {
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: planButtons },
  });
}

async function sendKHQR(bot, chatId, userId, plan) {
  const caption =
    `🏧 ${b('KHQR Payment')}\n\n` +
    `📦 Plan: ${b(plan.label)} — ${b('$' + plan.price)}\n` +
    `👤 Pay to: ${b(KHQR_NAME)}\n` +
    `📱 Account: ${c(KHQR_ACCOUNT)}\n\n` +
    `1️⃣ Scan the QR code above with your banking app\n` +
    `2️⃣ Pay exactly ${b('$' + plan.price)}\n` +
    `3️⃣ Take a screenshot of the payment confirmation\n` +
    `4️⃣ Send the screenshot here\n\n` +
    `⏳ Your request will be activated after the owner confirms payment.`;

  try {
    if (KHQR_IMAGE.startsWith('http')) {
      await bot.sendPhoto(chatId, KHQR_IMAGE, { caption, parse_mode: 'HTML' });
    } else {
      await bot.sendPhoto(chatId, fs.createReadStream(KHQR_IMAGE), { caption, parse_mode: 'HTML' });
    }
  } catch {
    // Fallback if image not found
    await send(bot, chatId,
      `🏧 ${b('KHQR Payment')}\n\n` +
      `⚠️ QR image not configured yet. Please contact the owner.\n\n` +
      caption
    );
  }
}

// /start
bot.onText(/\/start/, (msg) => {
  const userId = msg.from.id;
  const username = msg.from.username || msg.from.first_name || String(userId);

  if (db.admins.length === 0) {
    db.admins.push(userId);
    saveData(db);
    return send(bot, msg.chat.id,
      `👑 You are now the ${b('bot owner/admin!')}\n\nUse /admin to manage users.\n\n` + helpText()
    );
  }

  const status = accessStatus(userId);
  if (status.ok) {
    const user = db.approvedUsers[userId];
    const expiryLine = user && user.expiry ? `\n📅 Subscription expires: ${formatExpiry(user.expiry)}` : '';
    return send(bot, msg.chat.id, `✅ Welcome back, @${username}!${expiryLine}\n\n` + helpText());
  }

  if (status.reason === 'expired') {
    return sendSubscribePlans(msg.chat.id,
      `🔒 ${b('Your subscription has expired.')}\n\n` +
      `Choose a plan to renew via KHQR payment:`
    );
  }

  sendSubscribePlans(msg.chat.id,
    `👋 Hello @${username}!\n\n` +
    `Choose a subscription plan to get started or contact the owner https://t.me/CigarettesAfterSex_007:`
  );
});

// /subscribe — let any user pick a plan
bot.onText(/\/subscribe/, (msg) => {
  const userId = msg.from.id;
  if (isOwner(userId)) return send(bot, msg.chat.id, `👑 You are the owner — no subscription needed.`);
  sendSubscribePlans(msg.chat.id, `💳 ${b('Choose a subscription plan:')}`);
});

// ─── CALLBACK: plan selection ──────────────────────────────────────────────────
bot.on('callback_query', async (query) => {
  const userId = query.from.id;
  const chatId = query.message.chat.id;
  const username = query.from.username || query.from.first_name || String(userId);
  const data = query.data;

  await bot.answerCallbackQuery(query.id);

  // ── Plan selected ────────────────────────────────────────────────────────────
  if (data.startsWith('plan_')) {
    const planId = data.replace('plan_', '');
    const plan = PLANS.find(p => p.id === planId);
    if (!plan) return;

    pendingPayments[userId] = { planId, username, requestedAt: Date.now() };

    await bot.editMessageReplyMarkup({ inline_keyboard: [] }, {
      chat_id: chatId,
      message_id: query.message.message_id,
    }).catch(() => {});

    await send(bot, chatId,
      `✅ You selected: ${b(plan.label + ' — $' + plan.price)}\n\n` +
      `Scan the KHQR below and send your payment screenshot here.`
    );
    await sendKHQR(bot, chatId, userId, plan);

    // Notify admin
    const adminMsg =
      `💰 ${b('New Payment Request')}\n\n` +
      `👤 User: @${username} (${c(String(userId))})\n` +
      `📦 Plan: ${plan.label} — $${plan.price}\n` +
      `🕐 Time: ${phnomPenhTime()}\n\n` +
      `Wait for the user to send a payment screenshot, then use:\n` +
      `${c('/approve ' + userId + ' ' + plan.months)} to activate`;

    db.admins.forEach(adminId => send(bot, adminId, adminMsg).catch(() => {}));
    return;
  }

  // ── Admin confirms payment ────────────────────────────────────────────────────
  if (data.startsWith('confirm_')) {
    if (!isOwner(userId)) return send(bot, chatId, '⛔ Only the owner can confirm payments.');
    const parts = data.split('_'); // confirm_<userId>_<planId>
    const targetId = parseInt(parts[1]);
    const planId = parts[2];
    const plan = PLANS.find(p => p.id === planId);
    if (!plan) return;

    const targetUsername = pendingPayments[targetId]?.username || String(targetId);
    const expiry = addMonths(plan.months);

    // Check if already has subscription — extend from current expiry
    const existing = db.approvedUsers[targetId];
    const base = existing?.expiry && existing.expiry > Date.now() ? existing.expiry : Date.now();
    const newExpiry = new Date(base);
    newExpiry.setMonth(newExpiry.getMonth() + plan.months);

    db.approvedUsers[targetId] = {
      username: targetUsername,
      expiry: newExpiry.getTime(),
      approvedAt: Date.now(),
      warned: false,
      expiredNotified: false,
    };
    saveData(db);
    delete pendingPayments[targetId];

    await bot.editMessageReplyMarkup({ inline_keyboard: [] }, {
      chat_id: chatId,
      message_id: query.message.message_id,
    }).catch(() => {});

    send(bot, chatId,
      `✅ Payment confirmed for @${targetUsername}!\n` +
      `📦 Plan: ${plan.label}\n` +
      `⏰ Expires: ${formatExpiry(newExpiry.getTime())}`
    );

    send(bot, targetId,
      `🎉 ${b('Payment confirmed! Your subscription is now active.')}\n\n` +
      `📦 Plan: ${b(plan.label)}\n` +
      `⏰ Expires: ${b(formatExpiry(newExpiry.getTime()))}\n\n` +
      `Send /start to begin using the bot.`
    ).catch(() => {});
    return;
  }

  // ── Admin rejects payment ─────────────────────────────────────────────────────
  if (data.startsWith('reject_')) {
    if (!isOwner(userId)) return send(bot, chatId, '⛔ Only the owner can reject payments.');
    const targetId = parseInt(data.replace('reject_', ''));
    const targetUsername = pendingPayments[targetId]?.username || String(targetId);
    delete pendingPayments[targetId];

    await bot.editMessageReplyMarkup({ inline_keyboard: [] }, {
      chat_id: chatId,
      message_id: query.message.message_id,
    }).catch(() => {});

    send(bot, chatId, `🚫 Payment rejected for @${targetUsername}.`);
    send(bot, targetId,
      `❌ ${b('Your payment was not confirmed.')}\n\n` +
      `Please contact the owner or try again with /subscribe.`
    ).catch(() => {});
    return;
  }
});

bot.onText(/\/help/, (msg) => send(bot, msg.chat.id, helpText()));

bot.onText(/\/myid/, (msg) => {
  const user = db.approvedUsers[msg.from.id];
  const expiryLine = user && user.expiry ? `\n📅 Expires: ${formatExpiry(user.expiry)}` : '';
  send(bot, msg.chat.id,
    `🪪 Your User ID: ${c(String(msg.from.id))}\nUsername: @${msg.from.username || 'N/A'}${expiryLine}`
  );
});

// /admin — show panel
bot.onText(/\/admin/, (msg) => {
  if (!isOwner(msg.from.id)) return send(bot, msg.chat.id, '⛔ Only the bot owner can use /admin.');

  const entries = Object.entries(db.approvedUsers);
  const now = Date.now();
  const userList = entries.length
    ? entries.map(([id, u]) => {
        const expired = u.expiry && now > u.expiry;
        const status = expired ? '🔴 Expired' : '🟢 Active';
        const expLine = u.expiry ? formatExpiry(u.expiry) : 'No expiry';
        return `${status} ${c(id)} @${u.username || id}\n       📅 ${expLine}`;
      }).join('\n')
    : '(none)';

  send(bot, msg.chat.id,
    `👑 ${b('Admin Panel')}\n\n` +
    `${b('Approved Users:')}\n${userList}\n\n` +
    `${b('Commands:')}\n` +
    `${c('/approve @username &lt;months&gt;')} — Approve for N months\n` +
    `${c('/approve @username 0')} — Approve with no expiry\n` +
    `${c('/extend @username &lt;months&gt;')} — Extend subscription\n` +
    `${c('/revoke @username')} — Revoke access\n` +
    `${c('/users')} — List all users\n\n` +
    `💡 Example: /approve @john 1\n` +
    `💡 Example: /approve @john 2\n` +
    `💡 User must send /myid once so bot learns their username`
  );
});

// /approve <@username or userId> <months>
bot.onText(/\/approve\s+(\S+)(?:\s+(\d+))?/, (msg, match) => {
  if (!isOwner(msg.from.id)) return send(bot, msg.chat.id, '⛔ Only the owner can approve users.');
  const input = match[1];
  const months = match[2] ? parseInt(match[2]) : 1;

  let targetId;
  if (/^\d+$/.test(input)) {
    targetId = parseInt(input);
  } else {
    targetId = findUserIdByUsername(input);
    if (!targetId) return send(bot, msg.chat.id,
      `⚠️ Username ${c(input)} not found.\nAsk the user to send /myid first so the bot can learn their ID.`
    );
  }

  const expiry = months === 0 ? null : addMonths(months);
  const username = db.approvedUsers[targetId]?.username || String(targetId);

  db.approvedUsers[targetId] = {
    username,
    expiry,
    approvedAt: Date.now(),
    warned: false,
    expiredNotified: false,
  };
  saveData(db);

  const expiryText = expiry ? formatExpiry(expiry) : 'No expiry (lifetime)';
  send(bot, msg.chat.id,
    `✅ @${username} approved!\n` +
    `📅 Subscription: ${months === 0 ? 'Lifetime' : months + ' month(s)'}\n` +
    `⏰ Expires: ${expiryText}`
  );

  send(bot, targetId,
    `✅ ${b('Your account has been approved!')}\n` +
    `📅 Subscription: ${months === 0 ? 'Lifetime' : months + ' month(s)'}\n` +
    `⏰ Expires: ${expiryText}\n\n` +
    `You can now use the bot. Send /start to begin.`
  ).catch(() => {});
});

// /extend <@username or userId> <months>
bot.onText(/\/extend\s+(\S+)\s+(\d+)/, (msg, match) => {
  if (!isOwner(msg.from.id)) return send(bot, msg.chat.id, '⛔ Only the owner can extend subscriptions.');
  const input = match[1];
  const months = parseInt(match[2]);

  let targetId;
  if (/^\d+$/.test(input)) {
    targetId = parseInt(input);
  } else {
    targetId = findUserIdByUsername(input);
    if (!targetId) return send(bot, msg.chat.id,
      `⚠️ Username ${c(input)} not found.\nAsk the user to send /myid first.`
    );
  }

  const user = db.approvedUsers[targetId];
  if (!user) return send(bot, msg.chat.id, `⚠️ @${input} is not in the approved list. Use /approve first.`);

  const base = user.expiry && user.expiry > Date.now() ? user.expiry : Date.now();
  const newExpiry = new Date(base);
  newExpiry.setMonth(newExpiry.getMonth() + months);
  user.expiry = newExpiry.getTime();
  user.warned = false;
  user.expiredNotified = false;
  saveData(db);

  send(bot, msg.chat.id,
    `🔄 Extended @${user.username || targetId} by ${months} month(s)\n` +
    `⏰ New expiry: ${formatExpiry(user.expiry)}`
  );

  send(bot, targetId,
    `🎉 ${b('Your subscription has been extended!')}\n` +
    `📅 Extended by: ${months} month(s)\n` +
    `⏰ New expiry: ${formatExpiry(user.expiry)}\n\n` +
    `You can continue using the bot.`
  ).catch(() => {});
});

// /revoke <@username or userId>
bot.onText(/\/revoke\s+(\S+)/, (msg, match) => {
  if (!isOwner(msg.from.id)) return send(bot, msg.chat.id, '⛔ Only the owner can revoke users.');
  const input = match[1];

  let targetId;
  if (/^\d+$/.test(input)) {
    targetId = parseInt(input);
  } else {
    targetId = findUserIdByUsername(input);
    if (!targetId) return send(bot, msg.chat.id,
      `⚠️ Username ${c(input)} not found.`
    );
  }

  const user = db.approvedUsers[targetId];
  const displayName = user?.username ? '@' + user.username : String(targetId);
  delete db.approvedUsers[targetId];
  saveData(db);
  send(bot, msg.chat.id, `🚫 ${displayName} has been revoked.`);
  send(bot, targetId,
    `🔒 ${b('Your access has been revoked.')}\n\nPlease contact the owner to deposit and continue using the bot.`
  ).catch(() => {});
});

// /users — list all users with status
bot.onText(/\/users/, (msg) => {
  if (!isOwner(msg.from.id)) return send(bot, msg.chat.id, '⛔ Only the owner can view users.');
  const entries = Object.entries(db.approvedUsers);
  if (!entries.length) return send(bot, msg.chat.id, 'No approved users yet.');
  const now = Date.now();
  const lines = entries.map(([id, u]) => {
    const expired = u.expiry && now > u.expiry;
    const daysLeft = u.expiry ? Math.ceil((u.expiry - now) / (24*60*60*1000)) : null;
    const status = expired ? '🔴' : '🟢';
    const timeLeft = expired ? 'Expired' : daysLeft ? `${daysLeft}d left` : '∞';
    return `${status} ${c(id)} @${u.username || id} — ${timeLeft}`;
  });
  send(bot, msg.chat.id, `👥 ${b('All Users')}\n\n` + lines.join('\n'));
});

// /reset
bot.onText(/\/reset/, (msg) => {
  if (!isOwner(msg.from.id)) return send(bot, msg.chat.id, '⛔ Only the owner can reset data.');
  db.chats[msg.chat.id] = { exchangeRate: null, fee: null, deposits: [], payouts: [] };
  saveData(db);
  send(bot, msg.chat.id, `🔄 ${b('All data has been reset to zero!')}`);
});

// /summary
bot.onText(/\/summary/, (msg) => {
  const status = accessStatus(msg.from.id);
  if (!status.ok) return sendAccessDenied(bot, msg.chat.id, status.reason);
  send(bot, msg.chat.id, buildSummary(getChatState(msg.chat.id)));
});

// /clearbill
bot.onText(/\/clearbill/, (msg) => {
  const status = accessStatus(msg.from.id);
  if (!status.ok) return sendAccessDenied(bot, msg.chat.id, status.reason);
  const state = getChatState(msg.chat.id);
  state.deposits = [];
  state.payouts = [];
  saveData(db);
  send(bot, msg.chat.id, `🧹 ${b('Bill cleared!')} Deposits and payouts reset to 0.\nExchange rate and fee are kept.`);
});

function sendAccessDenied(bot, chatId, reason) {
  if (reason === 'expired') {
    return send(bot, chatId,
      `🔒 ${b('Your subscription has expired.')}\n\nPlease contact the owner to deposit and continue using the bot.`
    );
  }
  return send(bot, chatId,
    `⛔ You are not approved to use this bot.\nPlease contact the owner to get access.`
  );
}

// ─── PAYMENT SCREENSHOT HANDLER ───────────────────────────────────────────────
bot.on('photo', async (msg) => {
  const userId = msg.from.id;
  const chatId = msg.chat.id;
  const username = msg.from.username || msg.from.first_name || String(userId);

  if (isOwner(userId)) return; // owners don't need to pay
  if (!pendingPayments[userId]) return; // not in a payment flow

  const { planId } = pendingPayments[userId];
  const plan = PLANS.find(p => p.id === planId);
  if (!plan) return;

  await send(bot, chatId,
    `📨 ${b('Screenshot received!')}\n\n` +
    `The owner will verify your payment shortly.\n` +
    `You'll get a notification once confirmed. ✅`
  );

  // Forward screenshot + confirm/reject buttons to all admins
  const fileId = msg.photo[msg.photo.length - 1].file_id;
  const caption =
    `💳 ${b('Payment Screenshot')}\n\n` +
    `👤 @${username} (${c(String(userId))})\n` +
    `📦 ${plan.label} — $${plan.price}\n` +
    `🕐 ${phnomPenhTime()}\n\n` +
    `Tap ✅ Confirm to activate or ❌ Reject to decline.`;

  const buttons = [[
    { text: '✅ Confirm Payment', callback_data: `confirm_${userId}_${plan.id}` },
    { text: '❌ Reject',          callback_data: `reject_${userId}` },
  ]];

  db.admins.forEach(adminId => {
    bot.sendPhoto(adminId, fileId, {
      caption,
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: buttons },
    }).catch(() => {});
  });
});

// ─── MAIN MESSAGE HANDLER ─────────────────────────────────────────────────────
bot.on('message', (msg) => {
  const text = (msg.text || '').trim();
  if (text.startsWith('/')) return;
  if (!text) return;

  const userId = msg.from.id;
  const chatId = msg.chat.id;
  const username = msg.from.username || msg.from.first_name || String(userId);
  const time = phnomPenhTime();
  const replyExtra = msg.reply_to_message ? { reply_to_message_id: msg.reply_to_message.message_id } : {};

  // Save username when we see them
  if (db.approvedUsers[userId]) {
    db.approvedUsers[userId].username = username;
  }

  const status = accessStatus(userId);
  if (!status.ok) return sendAccessDenied(bot, chatId, status.reason);

  const state = getChatState(chatId);

  // clear bill
  if (/^clear\s*bill$/i.test(text)) {
    state.deposits = [];
    state.payouts = [];
    saveData(db);
    return send(bot, chatId, `🧹 <b>Bill cleared!</b> Deposits and payouts reset to 0.\nExchange rate and fee are kept.`);
  }

  // rate
  const rateMatch = text.match(/^rate\s+([\d.]+)$/i);
  if (rateMatch) {
    state.exchangeRate = parseFloat(rateMatch[1]);
    saveData(db);
    return send(bot, chatId,
      `⚙️ Exchange rate set to ${b(String(state.exchangeRate))}\n` +
      `Example: 100 / ${state.exchangeRate} = ${c(formatNumber(100 / state.exchangeRate))}`
    );
  }

  // fee
  const feeMatch = text.match(/^fee\s+([\d.]+)$/i);
  if (feeMatch) {
    state.fee = parseFloat(feeMatch[1]);
    saveData(db);
    return send(bot, chatId,
      `📉 Fee set to ${b(state.fee + '%')}\n` +
      `Example: 1000 → fee ${c(formatNumber(1000 * state.fee / 100))} → after fee ${c(formatNumber(1000 - 1000 * state.fee / 100))}`
    );
  }

  // withdraw
  const withdrawMatch = text.match(/^withdraw\s+([\d.]+)$/i);
  if (withdrawMatch) {
    const amount = parseFloat(withdrawMatch[1]);
    const exchangeRate = state.exchangeRate || 1;
    const feePercent = state.fee || 0;
    const totalDeposits = state.deposits.reduce((s, d) => s + d.amount, 0);
    const amountAfterFee = totalDeposits - totalDeposits * (feePercent / 100);
    const totalReceived = amountAfterFee / exchangeRate;
    const totalWithdrawn = state.payouts.reduce((s, d) => s + d.amount, 0);
    const available = totalReceived - totalWithdrawn;

    if (amount > available) {
      return send(bot, chatId, `⚠️ Withdraw ${b(formatNumber(amount))} exceeds available ${b(formatNumber(available))}`);
    }
    state.payouts.push({ amount, username, userId, time });
    saveData(db);
    return send(bot, chatId,
      `💸 ${b('Withdraw: ' + formatNumber(amount))}\n` +
      `👤 @${username}\n🕐 ${time}\n\n` +
      `Available before: ${c(formatNumber(available))}\n` +
      `Available after:  ${c(formatNumber(available - amount))}`,
      replyExtra
    );
  }

  // +number deposit
  const plusMatch = text.match(/^\+\s*([\d.]+)$/);
  if (plusMatch) {
    const amount = parseFloat(plusMatch[1]);
    state.deposits.push({ amount, username, userId, time });
    saveData(db);
    return send(bot, chatId, buildSummary(state), replyExtra);
  }

  // -number payout
  const minusMatch = text.match(/^-\s*([\d.]+)$/);
  if (minusMatch) {
    const amount = parseFloat(minusMatch[1]);
    state.payouts.push({ amount, username, userId, time });
    saveData(db);
    return send(bot, chatId, buildSummary(state), replyExtra);
  }
});

console.log('🤖 Bot is running...');
