import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { MessageService } from "../src/messages/message-service.js";
import { MessageError, InvalidPhoneNumberError } from "../src/errors/errors.js";
import type { WhatsAppTransport } from "../src/transport/transport.interface.js";

const TEST_MEDIA_DIR = path.resolve("./.temp/test-media");

function createMockTransport(): WhatsAppTransport {
  return {
    sendTextMessage: vi.fn().mockResolvedValue({
      id: "msg-123",
      to: "919876543210",
      timestamp: 1700000000000,
    }),
    sendMediaMessage: vi.fn().mockResolvedValue({
      id: "media-123",
      to: "919876543210",
      timestamp: 1700000000000,
    }),
  } as unknown as WhatsAppTransport;
}

describe("MessageService", () => {
  beforeEach(() => {
    fs.rmSync(TEST_MEDIA_DIR, { recursive: true, force: true });
    fs.mkdirSync(TEST_MEDIA_DIR, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(TEST_MEDIA_DIR, { recursive: true, force: true });
  });

  describe("sendText", () => {
    it("should send text message to valid normalized recipient", async () => {
      const transport = createMockTransport();
      const service = new MessageService(transport);

      const res = await service.sendText({
        to: "+91 98765-43210",
        text: "Hello, World!",
      });

      expect(res.id).toBe("msg-123");
      expect(transport.sendTextMessage).toHaveBeenCalledWith(
        "919876543210@s.whatsapp.net",
        "Hello, World!",
        { quote: undefined },
      );
    });

    it("should reject empty text", async () => {
      const transport = createMockTransport();
      const service = new MessageService(transport);

      await expect(service.sendText({ to: "919876543210", text: "" })).rejects.toThrow(
        MessageError,
      );
    });

    it("should reject invalid phone number", async () => {
      const transport = createMockTransport();
      const service = new MessageService(transport);

      await expect(service.sendText({ to: "invalid-number", text: "hi" })).rejects.toThrow(
        InvalidPhoneNumberError,
      );
    });
  });

  describe("sendImage", () => {
    it("should send image from file path", async () => {
      const transport = createMockTransport();
      const service = new MessageService(transport);

      const imgPath = path.join(TEST_MEDIA_DIR, "test.png");
      fs.writeFileSync(imgPath, Buffer.from("fake-png-data"));

      const res = await service.sendImage({
        to: "919876543210",
        path: imgPath,
        caption: "A nice image",
      });

      expect(res.id).toBe("media-123");
      expect(transport.sendMediaMessage).toHaveBeenCalledWith(
        "919876543210@s.whatsapp.net",
        "image",
        { path: imgPath },
        { caption: "A nice image", filename: undefined, mimetype: undefined, quote: undefined },
      );
    });

    it("should send image from Buffer", async () => {
      const transport = createMockTransport();
      const service = new MessageService(transport);
      const buffer = Buffer.from("in-memory-png");

      await service.sendImage({
        to: "919876543210",
        data: buffer,
        caption: "From buffer",
      });

      expect(transport.sendMediaMessage).toHaveBeenCalledWith(
        "919876543210@s.whatsapp.net",
        "image",
        { data: buffer },
        { caption: "From buffer", filename: undefined, mimetype: undefined, quote: undefined },
      );
    });

    it("should reject missing file path", async () => {
      const transport = createMockTransport();
      const service = new MessageService(transport);

      await expect(
        service.sendImage({
          to: "919876543210",
          path: "./non-existent-file.png",
        }),
      ).rejects.toThrow(MessageError);
    });

    it("should reject empty file (0 bytes)", async () => {
      const transport = createMockTransport();
      const service = new MessageService(transport);

      const emptyPath = path.join(TEST_MEDIA_DIR, "empty.png");
      fs.writeFileSync(emptyPath, "");

      await expect(
        service.sendImage({
          to: "919876543210",
          path: emptyPath,
        }),
      ).rejects.toThrow(MessageError);
    });
  });

  describe("sendDocument", () => {
    it("should sanitize document filename to prevent directory traversal", async () => {
      const transport = createMockTransport();
      const service = new MessageService(transport);

      const docPath = path.join(TEST_MEDIA_DIR, "secret.pdf");
      fs.writeFileSync(docPath, Buffer.from("pdf-contents"));

      await service.sendDocument({
        to: "919876543210",
        path: docPath,
        filename: "../../evil/payload.pdf",
      });

      expect(transport.sendMediaMessage).toHaveBeenCalledWith(
        "919876543210@s.whatsapp.net",
        "document",
        { path: docPath },
        expect.objectContaining({ filename: "payload.pdf" }),
      );
    });

    it("should reject empty buffer (0 bytes)", async () => {
      const transport = createMockTransport();
      const service = new MessageService(transport);

      await expect(
        service.sendDocument({
          to: "919876543210",
          data: Buffer.alloc(0),
          filename: "test.pdf",
        }),
      ).rejects.toThrow(MessageError);
    });

    it("should reject media exceeding 100MB limit", async () => {
      const transport = createMockTransport();
      const service = new MessageService(transport);

      // Create a real buffer with modified length property to simulate huge buffer without allocating 100MB RAM
      const hugeBuffer = Buffer.from("tiny");
      Object.defineProperty(hugeBuffer, "length", { value: 101 * 1024 * 1024 });

      await expect(
        service.sendDocument({
          to: "919876543210",
          data: hugeBuffer,
          filename: "huge.pdf",
        }),
      ).rejects.toThrow(/exceeds maximum allowed size/);
    });

    it("should reject non-buffer data when data option is used", async () => {
      const transport = createMockTransport();
      const service = new MessageService(transport);

      await expect(
        service.sendDocument({
          to: "919876543210",
          data: "not-a-buffer" as unknown as Buffer,
          filename: "test.pdf",
        }),
      ).rejects.toThrow(MessageError);
    });

    it("should reject when neither path nor data is provided", async () => {
      const transport = createMockTransport();
      const service = new MessageService(transport);

      await expect(
        service.sendDocument({
          to: "919876543210",
          filename: "test.pdf",
        } as unknown as Parameters<typeof service.sendDocument>[0]),
      ).rejects.toThrow(MessageError);
    });
  });

  describe("sendVideo and sendAudio", () => {
    it("should validate and send video message", async () => {
      const transport = createMockTransport();
      const service = new MessageService(transport);

      const vidPath = path.join(TEST_MEDIA_DIR, "video.mp4");
      fs.writeFileSync(vidPath, Buffer.from("video-bytes"));

      await service.sendVideo({
        to: "919876543210",
        path: vidPath,
        caption: "A video clip",
        ptv: true,
      });

      expect(transport.sendMediaMessage).toHaveBeenCalledWith(
        "919876543210@s.whatsapp.net",
        "video",
        { path: vidPath },
        expect.objectContaining({ caption: "A video clip", ptv: true }),
      );
    });

    it("should validate and send audio message with ptt option", async () => {
      const transport = createMockTransport();
      const service = new MessageService(transport);

      const audPath = path.join(TEST_MEDIA_DIR, "voice.ogg");
      fs.writeFileSync(audPath, Buffer.from("audio-bytes"));

      await service.sendAudio({
        to: "919876543210",
        path: audPath,
        ptt: true,
      });

      expect(transport.sendMediaMessage).toHaveBeenCalledWith(
        "919876543210@s.whatsapp.net",
        "audio",
        { path: audPath },
        expect.objectContaining({ ptt: true }),
      );
    });
  });
});
