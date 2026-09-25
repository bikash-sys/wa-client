import fs from "node:fs";
import path from "node:path";
import { MessageError } from "../errors/errors.js";
import { toWhatsAppJid } from "../utils/phone.js";
import type { WhatsAppTransport, MediaPayload } from "../transport/transport.interface.js";
import type {
  AudioMessageOptions,
  DocumentMessageOptions,
  ImageMessageOptions,
  MessageOptions,
  SentMessage,
  VideoMessageOptions,
} from "../types/index.js";

const MAX_MEDIA_FILE_SIZE_BYTES = 100 * 1024 * 1024; // 100 MB standard limit

/**
 * Service responsible for validating message recipients, validating media attachments,
 * and dispatching message requests through the transport.
 */
export class MessageService {
  private transport: WhatsAppTransport;

  constructor(transport: WhatsAppTransport) {
    this.transport = transport;
  }

  /**
   * Validates and dispatches a text message.
   */
  public async sendText(options: MessageOptions): Promise<SentMessage> {
    if (!options || typeof options !== "object") {
      throw new MessageError("Message options must be an object", "ERR_INVALID_MESSAGE_OPTIONS");
    }

    if (typeof options.text !== "string" || options.text.length === 0) {
      throw new MessageError("Message text must be a non-empty string", "ERR_EMPTY_MESSAGE_TEXT");
    }

    const jid = toWhatsAppJid(options.to);
    return this.transport.sendTextMessage(jid, options.text, { quote: options.quote });
  }

  /**
   * Validates and dispatches an image message.
   */
  public async sendImage(options: ImageMessageOptions): Promise<SentMessage> {
    const payload = this.validateMediaPayload(options, "image");
    const jid = toWhatsAppJid(options.to);

    return this.transport.sendMediaMessage(jid, "image", payload, {
      caption: options.caption,
      filename: options.filename,
      mimetype: options.mimetype,
      quote: options.quote,
    });
  }

  /**
   * Validates and dispatches a video message.
   */
  public async sendVideo(options: VideoMessageOptions): Promise<SentMessage> {
    const payload = this.validateMediaPayload(options, "video");
    const jid = toWhatsAppJid(options.to);

    return this.transport.sendMediaMessage(jid, "video", payload, {
      caption: options.caption,
      filename: options.filename,
      mimetype: options.mimetype,
      ptv: options.ptv,
      quote: options.quote,
    });
  }

  /**
   * Validates and dispatches an audio message.
   */
  public async sendAudio(options: AudioMessageOptions): Promise<SentMessage> {
    const payload = this.validateMediaPayload(options, "audio");
    const jid = toWhatsAppJid(options.to);

    return this.transport.sendMediaMessage(jid, "audio", payload, {
      filename: options.filename,
      mimetype: options.mimetype,
      ptt: options.ptt,
      quote: options.quote,
    });
  }

  /**
   * Validates and dispatches a document message.
   */
  public async sendDocument(options: DocumentMessageOptions): Promise<SentMessage> {
    const payload = this.validateMediaPayload(options, "document");
    const jid = toWhatsAppJid(options.to);

    let defaultFileName = options.filename;
    if (!defaultFileName && "path" in options && options.path) {
      defaultFileName = path.basename(options.path);
    }
    const sanitizedFileName = defaultFileName ? path.basename(defaultFileName) : "document";

    return this.transport.sendMediaMessage(jid, "document", payload, {
      caption: options.caption,
      filename: sanitizedFileName,
      mimetype: options.mimetype,
      quote: options.quote,
    });
  }

  private validateMediaPayload(
    options: { path?: string; data?: Buffer },
    mediaType: string,
  ): MediaPayload {
    if (!options || typeof options !== "object") {
      throw new MessageError(
        `Options for ${mediaType} message must be an object`,
        "ERR_INVALID_MEDIA_OPTIONS",
      );
    }

    if ("path" in options && typeof options.path === "string") {
      const resolvedPath = path.resolve(options.path);
      if (!fs.existsSync(resolvedPath)) {
        throw new MessageError(
          `Media file not found at path: "${options.path}"`,
          "ERR_FILE_NOT_FOUND",
        );
      }

      const stat = fs.statSync(resolvedPath);
      if (!stat.isFile()) {
        throw new MessageError(
          `Specified media path is not a file: "${options.path}"`,
          "ERR_INVALID_FILE",
        );
      }

      if (stat.size === 0) {
        throw new MessageError(
          `Media file is empty (0 bytes): "${options.path}"`,
          "ERR_EMPTY_FILE",
        );
      }

      if (stat.size > MAX_MEDIA_FILE_SIZE_BYTES) {
        throw new MessageError(
          `Media file exceeds maximum allowed size (100MB): "${options.path}" (${Math.round(stat.size / (1024 * 1024))}MB)`,
          "ERR_FILE_TOO_LARGE",
        );
      }

      return { path: resolvedPath };
    }

    if ("data" in options && options.data) {
      if (!Buffer.isBuffer(options.data)) {
        throw new MessageError(
          `Media data must be a valid Buffer for ${mediaType} message`,
          "ERR_INVALID_BUFFER",
        );
      }

      if (options.data.length === 0) {
        throw new MessageError(
          `Media Buffer cannot be empty (0 bytes) for ${mediaType} message`,
          "ERR_EMPTY_BUFFER",
        );
      }

      if (options.data.length > MAX_MEDIA_FILE_SIZE_BYTES) {
        throw new MessageError(
          `Media Buffer exceeds maximum allowed size (100MB): (${Math.round(options.data.length / (1024 * 1024))}MB)`,
          "ERR_BUFFER_TOO_LARGE",
        );
      }

      return { data: options.data };
    }

    throw new MessageError(
      `Either a valid file "path" or Buffer "data" must be provided for ${mediaType} message`,
      "ERR_MISSING_MEDIA_SOURCE",
    );
  }
}
