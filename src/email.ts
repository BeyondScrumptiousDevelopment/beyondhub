import PostalMime from 'postal-mime';
import { unzipSync, strFromU8 } from 'fflate';
import { UserError } from './security';

export interface ParsedEnquiry {
  /** The From header address; the envelope sender is checked separately. */
  from: string;
  subject: string;
  text: string;
  /** True when the receiving server recorded a failed DMARC check (a likely forgery). */
  dmarcFailed: boolean;
}

const MAX_CHAT_CHARS = 200_000;
const MAX_FILE_BYTES = 15 * 1024 * 1024;
// A zip can claim to unpack to gigabytes (a "zip bomb"), so cap what it may expand to.
const MAX_UNZIPPED_BYTES = 10 * 1024 * 1024;
const MAX_TEXT_FILES = 10;

/** WhatsApp exports are a .txt (Android) or a .zip holding _chat.txt (iPhone). */
export function chatTextFromAttachment(filename: string, mimeType: string, content: Uint8Array): string | null {
  const name = filename.toLowerCase();
  if (content.byteLength > MAX_FILE_BYTES) throw new UserError('That file is too large. Export the chat without media.', 413);
  if (name.endsWith('.txt') || mimeType === 'text/plain') {
    return strFromU8(content);
  }
  if (name.endsWith('.zip') || mimeType === 'application/zip') {
    let budget = MAX_UNZIPPED_BYTES;
    let count = 0;
    let files: Record<string, Uint8Array>;
    try {
      files = unzipSync(content, {
        filter: (f) => {
          if (!f.name.toLowerCase().endsWith('.txt')) return false;
          count += 1;
          budget -= f.originalSize;
          if (count > MAX_TEXT_FILES || budget < 0) throw new UserError('That zip is too large to read. Export the chat without media.', 413);
          return true;
        },
      });
    } catch (err) {
      if (err instanceof UserError) throw err;
      throw new UserError('That zip file could not be opened.');
    }
    const texts = Object.entries(files).map(([n, data]) => `--- ${n} ---\n${strFromU8(data)}`);
    return texts.length ? texts.join('\n\n') : null;
  }
  return null;
}

function toBytes(content: ArrayBuffer | Uint8Array | string): Uint8Array {
  if (typeof content === 'string') return new TextEncoder().encode(content);
  return content instanceof Uint8Array ? content : new Uint8Array(content);
}

export async function parseInboundEmail(raw: ReadableStream | ArrayBuffer): Promise<ParsedEnquiry> {
  const email = await PostalMime.parse(raw);
  const parts: string[] = [];

  const body = (email.text ?? '').trim();
  if (body) parts.push(`Email body:\n${body}`);

  for (const att of email.attachments ?? []) {
    const chat = chatTextFromAttachment(att.filename ?? '', att.mimeType ?? '', toBytes(att.content));
    if (chat) parts.push(`Attachment ${att.filename ?? ''}:\n${chat}`);
  }

  let text = parts.join('\n\n');
  if (text.length > MAX_CHAT_CHARS) {
    // Keep the most recent part of very long chats; that is where the current enquiry is.
    text = `[Earlier messages trimmed]\n${text.slice(-MAX_CHAT_CHARS)}`;
  }
  const authResults = email.headers
    .filter((h) => h.key === 'authentication-results')
    .map((h) => h.value.toLowerCase())
    .join(' ');
  return {
    from: (email.from && 'address' in email.from ? email.from.address : '') ?? '',
    subject: email.subject ?? '',
    text,
    dmarcFailed: /dmarc=fail/.test(authResults),
  };
}
