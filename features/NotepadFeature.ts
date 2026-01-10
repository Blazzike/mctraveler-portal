import { setSlotPacket, windowClickPacket } from '@/defined-packets.gen';
import { anonymousNbt, string, varInt } from '@/encoding/data-buffer';
import { registerCommand, syntax } from '@/feature-api/command';
import { defineFeature, FeatureHook, registerHook } from '@/feature-api/manager';
import p from '@/feature-api/paint';
import type { OnlinePlayer } from '@/modules/OnlinePlayersModule';
import PersistenceModule from '@/modules/PersistenceModule';
import { writePacket } from '@/network/defined-packet';
import { getPlayerSocket, getServerSocket } from '@/network/proxy';
import { safeWrite } from '@/network/util';

const { readNotepadData, writeNotepadData } = PersistenceModule.api;

const inNotepad = new WeakMap<OnlinePlayer, boolean>();
const playerHeldSlot = new WeakMap<OnlinePlayer, number>();

function buildWritableBookItem(pages: string[]): Buffer {
  const parts: Buffer[] = [];

  // Item Count (varint) - 1
  parts.push(varInt(1));

  // Item ID (varint) - writable_book = 1216 in 1.21.10
  parts.push(varInt(1216));

  // Number of components to add (varint) - 2: custom_name + writable_book_content
  parts.push(varInt(2));

  // Number of components to remove (varint)
  parts.push(varInt(0));

  // Component 1: custom_name (ID 5) - for the display name
  parts.push(varInt(5));
  parts.push(anonymousNbt({ text: 'Click to edit your notepad' }));

  // Component 2: writable_book_content (ID 45)
  parts.push(varInt(45));

  // Pages array (varint count + ItemBookPage[])
  parts.push(varInt(pages.length));
  for (const page of pages) {
    // ItemBookPage: content (string) + filteredContent (option<string>)
    parts.push(string(page));
    // filteredContent: has_value = false
    parts.push(Buffer.from([0x00]));
  }

  return Buffer.concat(parts);
}

function sendFakeBook(player: OnlinePlayer, pages: string[]): void {
  const socket = getPlayerSocket(player);
  if (!socket) return;

  const itemData = buildWritableBookItem(pages);

  // Get player's current held slot (0-8), default to 0
  const heldSlot = playerHeldSlot.get(player) ?? 0;
  // Convert hotbar slot (0-8) to inventory slot (36-44)
  const inventorySlot = heldSlot + 36;

  const setSlot = writePacket(setSlotPacket, {
    windowId: 0,
    stateId: 0,
    slot: inventorySlot,
    item: itemData,
  });
  safeWrite(socket, setSlot);
}

function parseEditBookPages(packetData: Buffer): string[] {
  let offset = 0;
  let b: number;
  let shift: number;

  // Hand (varint) - skip
  do {
    b = packetData[offset++] || 0;
  } while ((b & 0x80) !== 0);

  // Pages count (varint)
  let pageCount = 0;
  shift = 0;
  do {
    b = packetData[offset++] || 0;
    pageCount |= (b & 0x7f) << shift;
    shift += 7;
  } while ((b & 0x80) !== 0);

  const pages: string[] = [];
  for (let i = 0; i < pageCount; i++) {
    // Page length (varint)
    let pageLen = 0;
    shift = 0;
    do {
      b = packetData[offset++] || 0;
      pageLen |= (b & 0x7f) << shift;
      shift += 7;
    } while ((b & 0x80) !== 0);

    const page = packetData.toString('utf8', offset, offset + pageLen);
    offset += pageLen;
    pages.push(page);
  }

  return pages;
}

function triggerInventoryResync(player: OnlinePlayer): void {
  const serverSocket = getServerSocket(player);
  if (!serverSocket) return;

  const heldSlot = playerHeldSlot.get(player) ?? 0;
  const inventorySlot = heldSlot + 36;

  // Simulate pressing the number key to swap slot with itself
  // This causes server to reject and resend the actual slot contents
  // Mode 2 = hotbar swap, mouseButton = hotbar slot (0-8)
  const windowClick = writePacket(windowClickPacket, {
    windowId: 0,
    stateId: 0,
    slot: inventorySlot,
    mouseButton: heldSlot,
    mode: 2,
    changedSlots: [], // No changed slots
    cursorItem: null, // Empty cursor
  });
  safeWrite(serverSocket, windowClick);
}

function clearNotepadSession(player: OnlinePlayer): void {
  if (inNotepad.get(player)) {
    inNotepad.delete(player);
    triggerInventoryResync(player);
    player.sendMessage(p.error`Your notepad editing session has been cancelled`);
  }
}

export default defineFeature({
  name: 'Notepad',
  onEnable: () => {
    // Handle Edit Book - save notepad when player clicks Done
    registerHook(FeatureHook.EditBook, ({ player, packetData }) => {
      if (!inNotepad.get(player)) {
        return false;
      }

      inNotepad.delete(player);
      triggerInventoryResync(player);

      try {
        const pages = parseEditBookPages(packetData);
        writeNotepadData(player.uuid, pages);
        player.sendMessage(p.success`Notepad saved`);
      } catch (error) {
        console.error('[Notepad] Error parsing edit book packet:', error);
        player.sendMessage(p.error`Failed to save notepad`);
      }

      return true; // We handled it
    });

    // Track held slot and clear notepad session when player changes held item
    registerHook(FeatureHook.HeldItemChange, ({ player, packetData }) => {
      const slot = packetData.readInt16BE(0);
      playerHeldSlot.set(player, slot);
      clearNotepadSession(player);
    });

    // Clear notepad session when player clicks in inventory
    registerHook(FeatureHook.InventoryClick, ({ player }) => {
      clearNotepadSession(player);
    });

    registerCommand(syntax`notepad`, ({ sender }) => {
      if (inNotepad.get(sender)) {
        return p.gray`You're already editing your notepad`;
      }

      const existingPages = readNotepadData(sender.uuid);
      const pages = existingPages.length > 0 ? existingPages : ["This is your private note taking space. It's with you everywhere."];

      sendFakeBook(sender, pages);
      inNotepad.set(sender, true);
    });
  },
});
