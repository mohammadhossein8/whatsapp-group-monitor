#!/Users/melligold/miniconda3/bin/python3
"""
Quick status checker for WhatsApp Web connection.
Runs silently in headless mode (no browser popup) and checks connection status.
"""

import sys
import time
from datetime import datetime
from whatsapp import WhatsAppClient

def check_status():
    print("🔍 Checking WhatsApp connection...")
    client = WhatsAppClient(headless=True)
    try:
        client.start()
        
        # Wait up to 15 seconds for sync
        if not client.wait_for_login(timeout_sec=15):
            print("❌ Not connected or session expired (QR code scan required).")
            print("Run './main.py' to view the browser window and scan the QR code.")
            return False

        print("\n✅ WhatsApp is CONNECTED and authenticated!")
        
        # Fetch 3 recent chats
        chats = client.get_recent_chats(limit=3)
        print(f"📋 Recent chats ({len(chats)}):")
        for i, c in enumerate(chats, 1):
            unread = f" [{c['unreadCount']} unread]" if c['unreadCount'] > 0 else ""
            print(f"   {i}. {c['name']}{unread}")

        # Check target apartment group
        data = client.get_messages("چکاوک", limit=1)
        if "messages" in data and data["messages"]:
            last = data["messages"][-1]
            t_str = datetime.fromtimestamp(last['timestamp'] / 1000).strftime('%Y-%m-%d %H:%M') if last['timestamp'] else ''
            sender = "You" if last['fromMe'] else f"{last['author']}"
            print(f"\n🏢 Latest message in '{data.get('chatName')}':")
            print(f"   [{t_str}] {sender}: {last['body'][:120]}...")

        return True
    except Exception as e:
        print(f"❌ Error checking connection: {e}")
        return False
    finally:
        client.close()

if __name__ == "__main__":
    check_status()
