import "server-only";
import type { Author, Message } from "./types";
import { sendWhatsApp } from "./twilio";
import { sendInstagram } from "../instagram/send";

/** Send a text to any chat, over the channel it belongs to (WhatsApp or Instagram). */
export function sendMessage(opts: { to: string; body: string; author: Author }): Promise<Message> {
  return opts.to.startsWith("instagram:") ? sendInstagram(opts) : sendWhatsApp(opts);
}
