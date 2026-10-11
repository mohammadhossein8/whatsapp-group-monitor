#!/Users/melligold/miniconda3/bin/python3
"""
Pure Python WhatsApp Client using Playwright
Supports persistent login, message reading, and sending.
"""

import time
import os
from typing import List, Dict, Optional, Any
from playwright.sync_api import sync_playwright, BrowserContext, Page

class WhatsAppClient:
    def __init__(self, session_dir: str = "./whatsapp_session_py", headless: bool = False):
        self.session_dir = os.path.abspath(session_dir)
        self.headless = headless
        self.playwright = None
        self.context: Optional[BrowserContext] = None
        self.page: Optional[Page] = None

    def start(self) -> "WhatsAppClient":
        """Starts the browser and opens WhatsApp Web."""
        print(f"[Python WhatsApp] Starting browser (session dir: {self.session_dir})...")
        self.playwright = sync_playwright().start()

        # Launch persistent context so login is preserved
        self.context = self.playwright.chromium.launch_persistent_context(
            user_data_dir=self.session_dir,
            headless=self.headless,
            user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
            viewport={"width": 1280, "height": 800},
            args=[
                "--no-sandbox",
                "--disable-dev-shm-usage",
                "--disable-blink-features=AutomationControlled"
            ]
        )

        self.page = self.context.pages[0] if self.context.pages else self.context.new_page()
        
        print("[Python WhatsApp] Opening https://web.whatsapp.com ...")
        self.page.goto("https://web.whatsapp.com")
        return self

    def wait_for_login(self, timeout_sec: int = 120) -> bool:
        """Waits for user to scan QR code (if needed) and ensures chat models are fully synchronized."""
        print("[Python WhatsApp] Checking login and syncing chats...")
        start_time = time.time()

        while time.time() - start_time < timeout_sec:
            sync_status = self.page.evaluate("""() => {
                try {
                    const ChatCol = window.require && window.require('WAWebCollections')?.Chat;
                    if (!ChatCol) return { ready: false, count: 0 };
                    const models = ChatCol.getModelsArray();
                    return {
                        ready: models.length > 0,
                        count: models.length
                    };
                } catch(e) {
                    return { ready: false, count: 0 };
                }
            }""")

            if sync_status.get("ready"):
                print(f"[Python WhatsApp] WhatsApp is ready! Synced {sync_status.get('count')} chats.")
                # Give a 2-second buffer for message stores to settle
                time.sleep(2)
                return True

            # Check if QR code is present
            has_qr = self.page.locator("canvas[aria-label='Scan me!'], div[data-ref]").count() > 0
            if has_qr:
                print("[Python WhatsApp] QR code is displayed on the screen. Please scan it with your phone...")

            time.sleep(2)

        print("[Python WhatsApp] Login wait timed out.")
        return False

    def get_recent_chats(self, limit: int = 10) -> List[Dict[str, Any]]:
        """Returns the most recent chats."""
        if not self.page:
            raise RuntimeError("Client not started. Call .start() first.")

        return self.page.evaluate("""(limit) => {
            try {
                const ChatCol = window.require('WAWebCollections')?.Chat;
                if (!ChatCol) return [];

                const models = ChatCol.getModelsArray();
                const list = [];

                for (const c of models) {
                    let lastMsgText = '';
                    let lastMsgTime = null;
                    let lastMsgFromMe = false;

                    let msgsArray = [];
                    if (c.msgs && typeof c.msgs.getModelsArray === 'function') {
                        msgsArray = c.msgs.getModelsArray();
                    } else if (c.msgs && Array.isArray(c.msgs._models)) {
                        msgsArray = c.msgs._models;
                    }

                    if (msgsArray && msgsArray.length > 0) {
                        const lastMsg = msgsArray[msgsArray.length - 1];
                        if (lastMsg) {
                            lastMsgText = lastMsg.body || lastMsg.caption || (lastMsg.type ? `[${lastMsg.type}]` : '');
                            lastMsgTime = lastMsg.t ? lastMsg.t * 1000 : null;
                            lastMsgFromMe = Boolean(lastMsg.id && lastMsg.id.fromMe);
                        }
                    }

                    const chatTime = (c.t ? c.t * 1000 : 0) || lastMsgTime || 0;
                    const title = c.formattedTitle || c.name || c.contact?.name || c.contact?.pushname || c.id?.user || 'Unknown';

                    list.push({
                        id: c.id ? c.id._serialized : '',
                        name: title,
                        isGroup: Boolean(c.isGroup),
                        unreadCount: c.unreadCount || 0,
                        timestamp: chatTime,
                        lastMessage: lastMsgText ? {
                            body: lastMsgText,
                            fromMe: lastMsgFromMe,
                            time: lastMsgTime
                        } : null
                    });
                }

                list.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
                return list.slice(0, limit);
            } catch (err) {
                return [];
            }
        }""", limit)

    def get_messages(self, chat_name_or_keyword: str, limit: int = 20) -> Dict[str, Any]:
        """Returns the latest messages from a chat matching the name or keyword."""
        if not self.page:
            raise RuntimeError("Client not started. Call .start() first.")

        result = self.page.evaluate("""async ({keyword, limit}) => {
            try {
                const ChatCol = window.require('WAWebCollections')?.Chat;
                if (!ChatCol) return { error: 'No Chat Collection' };

                const all = ChatCol.getModelsArray();
                const targetChat = all.find(c => 
                    (c.formattedTitle && c.formattedTitle.includes(keyword)) ||
                    (c.name && c.name.includes(keyword)) ||
                    (c.id && c.id._serialized.includes(keyword))
                );

                if (!targetChat) return { error: `Chat matching "${keyword}" not found` };

                // Try to load earlier messages if needed
                if (targetChat.loadEarlierMsgs) {
                    try { await targetChat.loadEarlierMsgs(); } catch(e) {}
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
                    chatName: targetChat.formattedTitle || targetChat.name,
                    chatId: targetChat.id?._serialized,
                    messages: formatted
                };
            } catch (err) {
                return { error: err.message || String(err) };
            }
        }""", {"keyword": chat_name_or_keyword, "limit": limit})

        return result

    def send_message(self, chat_name_or_keyword: str, message_text: str) -> bool:
        """Sends a text message to a chat matching name or keyword."""
        if not self.page:
            raise RuntimeError("Client not started. Call .start() first.")

        return self.page.evaluate("""async ({keyword, text}) => {
            const ChatCol = window.require('WAWebCollections')?.Chat;
            if (!ChatCol) throw new Error('Chat collection not available');

            const all = ChatCol.getModelsArray();
            const targetChat = all.find(c => 
                (c.formattedTitle && c.formattedTitle.includes(keyword)) ||
                (c.name && c.name.includes(keyword)) ||
                (c.id && c.id._serialized.includes(keyword))
            );

            if (!targetChat) throw new Error(`Chat "${keyword}" not found`);

            const SendMsg = window.require('WAWebSendMessage');
            if (SendMsg && SendMsg.addAndSendMsgToChat) {
                await SendMsg.addAndSendMsgToChat(targetChat, { body: text });
            } else {
                await targetChat.sendMessage(text);
            }
            return true;
        }""", {"keyword": chat_name_or_keyword, "text": message_text})

    def close(self):
        """Closes browser session."""
        if self.context:
            self.context.close()
        if self.playwright:
            self.playwright.stop()
        print("[Python WhatsApp] Session closed.")
