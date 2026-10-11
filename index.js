const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcodeTerminal = require('qrcode-terminal');
const QRCode = require('qrcode');
const http = require('http');
const fs = require('fs');
const path = require('path');

let latestQrDataUrl = null;
let isReady = false;
let clientInfo = null;

const TARGET_GROUP_ID = '120363039581616863@g.us';
const TARGET_KEYWORD = 'چکاوک';

// Escape text before placing it into the dashboard HTML
function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// Locate Chrome for the current OS; CHROME_PATH overrides, and undefined falls back to Puppeteer's own browser
function findChrome() {
    if (process.env.CHROME_PATH) return process.env.CHROME_PATH;

    const candidates = {
        darwin: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'],
        win32: [
            process.env.PROGRAMFILES,
            process.env['PROGRAMFILES(X86)'],
            process.env.LOCALAPPDATA
        ].filter(Boolean).map(dir => path.join(dir, 'Google', 'Chrome', 'Application', 'chrome.exe')),
        linux: ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser']
    }[process.platform] || [];

    return candidates.find(p => fs.existsSync(p));
}

// Initialize WhatsApp client
const client = new Client({
    authStrategy: new LocalAuth({
        dataPath: './.wwebjs_auth'
    }),
    puppeteer: {
        executablePath: findChrome(),
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu'
        ]
    }
});

// Fetch messages for the focused group
async function getChakavakMessages(limit = 30) {
    try {
        const result = await client.pupPage.evaluate((targetId, keyword, limit) => {
            try {
                const ChatCol = window.require('WAWebCollections')?.Chat;
                if (!ChatCol) return { error: 'WAWebCollections.Chat not found' };

                let targetChat = ChatCol.get(targetId);
                if (!targetChat) {
                    const all = ChatCol.getModelsArray();
                    targetChat = all.find(c => 
                        (c.formattedTitle && c.formattedTitle.includes(keyword)) ||
                        (c.name && c.name.includes(keyword))
                    );
                }

                if (!targetChat) {
                    return { error: `Chat with keyword "${keyword}" or ID "${targetId}" not found` };
                }

                let msgs = [];
                if (targetChat.msgs && typeof targetChat.msgs.getModelsArray === 'function') {
                    msgs = targetChat.msgs.getModelsArray();
                } else if (targetChat.msgs && Array.isArray(targetChat.msgs._models)) {
                    msgs = targetChat.msgs._models;
                }

                const contactCol = window.require('WAWebCollections')?.Contact;

                const formatted = msgs.slice(-limit).map(m => {
                    const authorWid = m.author || m.from;
                    let authorName = 'Unknown';
                    let authorPhone = '';

                    if (authorWid) {
                        const widStr = authorWid._serialized || authorWid;
                        const contact = contactCol?.get(widStr);
                        authorName = contact?.name || contact?.pushname || authorWid.user || widStr;
                        authorPhone = authorWid.user || '';
                    }

                    return {
                        id: m.id?._serialized,
                        fromMe: Boolean(m.id?.fromMe),
                        author: authorName,
                        authorPhone: authorPhone,
                        body: m.body || m.caption || (m.type ? `[${m.type}]` : ''),
                        type: m.type,
                        timestamp: m.t ? m.t * 1000 : null
                    };
                });

                return {
                    chatName: targetChat.formattedTitle || targetChat.name || 'ساختمان چکاوک بلوک A',
                    chatId: targetChat.id?._serialized,
                    messages: formatted
                };
            } catch (err) {
                return { error: err.message || String(err) };
            }
        }, TARGET_GROUP_ID, TARGET_KEYWORD, limit);

        return result;
    } catch (err) {
        console.error('Error fetching Chakavak messages:', err);
        return { error: err.message || String(err) };
    }
}

// Send message to the focused group
async function sendToChakavak(text) {
    try {
        const chats = await client.pupPage.evaluate(async (targetId, keyword, text) => {
            const ChatCol = window.require('WAWebCollections')?.Chat;
            let targetChat = ChatCol.get(targetId);
            if (!targetChat) {
                const all = ChatCol.getModelsArray();
                targetChat = all.find(c => 
                    (c.formattedTitle && c.formattedTitle.includes(keyword)) ||
                    (c.name && c.name.includes(keyword))
                );
            }
            if (!targetChat) throw new Error('Chat not found');
            
            const SendMsg = window.require('WAWebSendMessage');
            if (SendMsg && SendMsg.addAndSendMsgToChat) {
                await SendMsg.addAndSendMsgToChat(targetChat, { body: text });
            } else {
                await targetChat.sendMessage(text);
            }
            return true;
        }, TARGET_GROUP_ID, TARGET_KEYWORD, text);
        return { success: true };
    } catch (err) {
        return { error: err.message || String(err) };
    }
}

// HTTP Server
const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost:3000');

    // API to get messages of Chakavak
    if (url.pathname === '/api/chakavak/messages') {
        if (!isReady) {
            res.writeHead(503, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'WhatsApp not ready' }));
            return;
        }
        const limit = parseInt(url.searchParams.get('limit') || '30', 10);
        const data = await getChakavakMessages(limit);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(data, null, 2));
        return;
    }

    // API to send message to Chakavak
    if (url.pathname === '/api/chakavak/send' && req.method === 'POST') {
        // Browsers can't send JSON cross-site without a preflight, so this blocks other websites from posting
        if (!(req.headers['content-type'] || '').startsWith('application/json')) {
            res.writeHead(415, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Content-Type must be application/json' }));
            return;
        }
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
            try {
                const { text } = JSON.parse(body);
                if (!text) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Text required' }));
                    return;
                }
                const result = await sendToChakavak(text);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(result));
            } catch (err) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: err.message }));
            }
        });
        return;
    }

    // Web Dashboard UI
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    if (isReady) {
        const data = await getChakavakMessages(30);
        const msgs = data.messages || [];

        const messagesHtml = msgs.map(m => {
            const timeStr = m.timestamp ? new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
            const isMe = m.fromMe;
            return `
                <div style="display: flex; justify-content: ${isMe ? 'flex-end' : 'flex-start'}; margin-bottom: 12px;">
                    <div style="max-width: 75%; background: ${isMe ? '#005c4b' : '#202c33'}; color: #e9edef; padding: 10px 14px; border-radius: 10px; box-shadow: 0 1px 2px rgba(0,0,0,0.3); font-size: 14px; direction: rtl; text-align: right;">
                        ${!isMe ? `<div style="font-weight: 600; color: #53bdeb; font-size: 12px; margin-bottom: 4px;">${escapeHtml(m.author)} ${m.authorPhone ? `(${escapeHtml(m.authorPhone)})` : ''}</div>` : ''}
                        <div style="white-space: pre-wrap; line-height: 1.5;">${escapeHtml(m.body)}</div>
                        <div style="font-size: 10px; color: ${isMe ? '#7cc5af' : '#8696a0'}; text-align: left; margin-top: 4px; direction: ltr;">${timeStr}</div>
                    </div>
                </div>
            `;
        }).join('');

        res.end(`
            <!DOCTYPE html>
            <html lang="fa">
            <head>
                <meta charset="utf-8">
                <title>ساختمان چکاوک بلوک A</title>
                <meta http-equiv="refresh" content="10">
            </head>
            <body style="font-family: system-ui, -apple-system, sans-serif; background: #0b141a; color: #e9edef; margin: 0; padding: 20px; display: flex; justify-content: center;">
                <div style="width: 100%; max-width: 720px; background: #111b21; border: 1px solid #222d34; border-radius: 12px; display: flex; flex-direction: column; height: 92vh; overflow: hidden;">
                    <!-- Header -->
                    <div style="padding: 16px 20px; background: #202c33; border-bottom: 1px solid #2a3942; display: flex; justify-content: space-between; align-items: center; direction: rtl;">
                        <div>
                            <h2 style="margin: 0; font-size: 18px; color: #e9edef;">ساختمان چکاوک بلوک A</h2>
                            <span style="font-size: 12px; color: #25d366;">● حالت مانیتورینگ اختصاصی فعال</span>
                        </div>
                        <span style="font-size: 12px; color: #8696a0;">${msgs.length} پیام اخیر</span>
                    </div>

                    <!-- Messages list -->
                    <div style="flex: 1; padding: 20px; overflow-y: auto; background: #0b141a;">
                        ${messagesHtml || '<p style="text-align: center; color: #8696a0;">در حال دریافت پیام‌ها...</p>'}
                    </div>

                    <!-- Footer input note -->
                    <div style="padding: 12px 20px; background: #202c33; border-top: 1px solid #2a3942; font-size: 12px; color: #8696a0; text-align: center; direction: rtl;">
                        این صفحه هر ۱۰ ثانیه به‌روزرسانی می‌شود.
                    </div>
                </div>
            </body>
            </html>
        `);
        return;
    }

    if (latestQrDataUrl) {
        res.end(`<h2>Scan QR</h2><img src="${latestQrDataUrl}" />`);
    } else {
        res.end(`<h2>Connecting to WhatsApp...</h2>`);
    }
});

const PORT = 3000;
// Bind to localhost only so other devices on the network can't reach the dashboard or API
server.listen(PORT, '127.0.0.1', () => {
    console.log(`[Focus Mode] Web viewer running at: http://localhost:${PORT}`);
});

client.on('qr', async (qr) => {
    qrcodeTerminal.generate(qr, { small: true });
    try { latestQrDataUrl = await QRCode.toDataURL(qr); } catch (e) {}
});

client.on('authenticated', () => {
    console.log('[WhatsApp] Session authenticated.');
});

client.on('ready', async () => {
    isReady = true;
    clientInfo = {
        name: client.info?.pushname || 'User',
        number: client.info?.wid?.user || 'Unknown'
    };
    console.log(`\n========================================`);
    console.log(`[WhatsApp] Connected as: ${clientInfo.name} (+${clientInfo.number})`);
    console.log(`[Focus Mode] TARGET: ساختمان چکاوک بلوک A`);
    console.log(`========================================\n`);

    setTimeout(async () => {
        console.log('[Focus Mode] Querying messages for ساختمان چکاوک بلوک A...');
        const data = await getChakavakMessages(20);
        console.log('=== CHAKAVAK MESSAGES DATA ===');
        console.log(JSON.stringify(data, null, 2));
        console.log('=== END CHAKAVAK DATA ===');
    }, 3000);
});

// Real-time listener for incoming messages
client.on('message', async (msg) => {
    const chat = await msg.getChat().catch(() => null);
    const isTarget = (msg.from === TARGET_GROUP_ID) || 
                     (chat && (chat.name?.includes(TARGET_KEYWORD) || chat.formattedTitle?.includes(TARGET_KEYWORD)));

    if (isTarget) {
        const contact = await msg.getContact().catch(() => null);
        const sender = contact?.pushname || contact?.name || msg.author || msg.from;
        console.log(`\n🔔 [NEW MESSAGE IN چـکـاوک]`);
        console.log(`From: ${sender}`);
        console.log(`Body: ${msg.body}`);
        console.log(`Time: ${new Date().toLocaleTimeString()}\n`);
    }
});

client.initialize();
