#!/Users/melligold/miniconda3/bin/python3
"""
Main script focusing on ساختمان چکاوک بلوک A using Python Playwright
"""

import sys
import time
from datetime import datetime
from whatsapp import WhatsAppClient

def main():
    print("=" * 55)
    print("🚀 Starting Pure Python WhatsApp Client")
    print("=" * 55)

    # headless=False shows the browser window on your Mac screen
    client = WhatsAppClient(headless=False)
    client.start()

    print("\n⏳ Waiting for WhatsApp authentication...")
    print("If a QR code appears in the Chrome window on your screen,")
    print("please scan it using WhatsApp on your phone (Linked Devices).\n")

    if not client.wait_for_login(timeout_sec=120):
        print("❌ Login timed out. Please run again.")
        client.close()
        sys.exit(1)

    print("\n✅ Authentication successful!\n")

    # 1. Fetch recent chats
    print("--- 📋 5 Recent Chats ---")
    chats = client.get_recent_chats(limit=5)
    for i, c in enumerate(chats, 1):
        last_body = c['lastMessage']['body'] if c['lastMessage'] else 'No messages'
        print(f"{i}. {c['name']} {'(Group)' if c['isGroup'] else ''}")
        print(f"   Last: {last_body}")

    # 2. Focus on ساختمان چکاوک بلوک A
    print("\n" + "=" * 55)
    print("🏢 Focus: ساختمان چکاوک بلوک A")
    print("=" * 55)

    data = client.get_messages("چکاوک", limit=20)
    if "error" in data:
        print(f"⚠️ Error: {data['error']}")
    else:
        messages = data.get("messages", [])
        print(f"Loaded {len(messages)} messages from '{data.get('chatName')}':\n")
        for m in messages:
            t_str = datetime.fromtimestamp(m['timestamp'] / 1000).strftime('%Y-%m-%d %H:%M') if m['timestamp'] else ''
            sender = "You" if m['fromMe'] else f"{m['author']} ({m['authorPhone']})"
            print(f"[{t_str}] {sender}:")
            print(f"   {m['body']}\n")

    print("WhatsApp is active in Python. Keeping session open...")
    try:
        while True:
            time.sleep(5)
    except KeyboardInterrupt:
        print("\nStopping...")
        client.close()

if __name__ == "__main__":
    main()
