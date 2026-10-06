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

    it("should send image with options object including custom mimetype", async () => {
      const transport = createMockTransport();
      const service = new MessageService(transport);
      const buffer = Buffer.from("png-data");

      await service.sendImage({
        to: "919876543210",
        data: buffer,
        caption: "Custom mime image",
        mimetype: "image/png",
        filename: "custom.png",
      });

      expect(transport.sendMediaMessage).toHaveBeenCalledWith(
        "919876543210@s.whatsapp.net",
        "image",
        { data: buffer },
        {
          caption: "Custom mime image",
          filename: "custom.png",
          mimetype: "image/png",
          quote: undefined,
        },
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

    it("should reject empty Buffer (0 bytes)", async () => {
      const transport = createMockTransport();
      const service = new MessageService(transport);

      await expect(
        service.sendImage({
          to: "919876543210",
          data: Buffer.alloc(0),
        }),
      ).rejects.toThrow(MessageError);
    });

    it("should reject image file exceeding 100MB limit", async () => {
      const transport = createMockTransport();
      const service = new MessageService(transport);

      const hugeBuffer = Buffer.from("tiny");
      Object.defineProperty(hugeBuffer, "length", { value: 101 * 1024 * 1024 });

      await expect(
        service.sendImage({
          to: "919876543210",
          data: hugeBuffer,
        }),
      ).rejects.toThrow(/exceeds maximum allowed size/);
    });
  });

  describe("sendVideo", () => {
    it("should send video from file path with caption and ptv option", async () => {
      const transport = createMockTransport();
      const service = new MessageService(transport);

      const vidPath = path.join(TEST_MEDIA_DIR, "video.mp4");
      fs.writeFileSync(vidPath, Buffer.from("video-bytes"));

      const res = await service.sendVideo({
        to: "919876543210",
        path: vidPath,
        caption: "A video clip",
        ptv: true,
      });

      expect(res.id).toBe("media-123");
      expect(transport.sendMediaMessage).toHaveBeenCalledWith(
        "919876543210@s.whatsapp.net",
        "video",
        { path: vidPath },
        expect.objectContaining({ caption: "A video clip", ptv: true }),
      );
    });

    it("should send video from Buffer", async () => {
      const transport = createMockTransport();
      const service = new MessageService(transport);
      const vidBuffer = Buffer.from("video-buffer-bytes");

      await service.sendVideo({
        to: "919876543210",
        data: vidBuffer,
        caption: "Buffer video",
      });

      expect(transport.sendMediaMessage).toHaveBeenCalledWith(
        "919876543210@s.whatsapp.net",
        "video",
        { data: vidBuffer },
        expect.objectContaining({ caption: "Buffer video" }),
      );
    });

    it("should reject missing video file path", async () => {
      const transport = createMockTransport();
      const service = new MessageService(transport);

      await expect(
        service.sendVideo({
          to: "919876543210",
          path: "./non-existent-video.mp4",
        }),
      ).rejects.toThrow(MessageError);
    });

    it("should reject empty video file (0 bytes)", async () => {
      const transport = createMockTransport();
      const service = new MessageService(transport);

      const emptyPath = path.join(TEST_MEDIA_DIR, "empty.mp4");
      fs.writeFileSync(emptyPath, "");

      await expect(
        service.sendVideo({
          to: "919876543210",
          path: emptyPath,
        }),
      ).rejects.toThrow(MessageError);
    });

    it("should reject empty video Buffer (0 bytes)", async () => {
      const transport = createMockTransport();
      const service = new MessageService(transport);

      await expect(
        service.sendVideo({
          to: "919876543210",
          data: Buffer.alloc(0),
        }),
      ).rejects.toThrow(MessageError);
    });

    it("should reject video exceeding 100MB limit", async () => {
      const transport = createMockTransport();
      const service = new MessageService(transport);

      const hugeBuffer = Buffer.from("tiny");
      Object.defineProperty(hugeBuffer, "length", { value: 101 * 1024 * 1024 });

      await expect(
        service.sendVideo({
          to: "919876543210",
          data: hugeBuffer,
        }),
      ).rejects.toThrow(/exceeds maximum allowed size/);
    });
  });

  describe("sendAudio", () => {
    it("should validate and send normal audio message (ptt false)", async () => {
      const transport = createMockTransport();
      const service = new MessageService(transport);

      const audPath = path.join(TEST_MEDIA_DIR, "song.mp3");
      fs.writeFileSync(audPath, Buffer.from("audio-song-bytes"));

      const res = await service.sendAudio({
        to: "919876543210",
        path: audPath,
        ptt: false,
      });

      expect(res.id).toBe("media-123");
      expect(transport.sendMediaMessage).toHaveBeenCalledWith(
        "919876543210@s.whatsapp.net",
        "audio",
        { path: audPath },
        expect.objectContaining({ ptt: false }),
      );
    });

    it("should validate and send voice note audio message (ptt true)", async () => {
      const transport = createMockTransport();
      const service = new MessageService(transport);

      const audPath = path.join(TEST_MEDIA_DIR, "voice.ogg");
      fs.writeFileSync(audPath, Buffer.from("audio-voice-bytes"));

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

    it("should send audio from Buffer", async () => {
      const transport = createMockTransport();
      const service = new MessageService(transport);
      const audioBuffer = Buffer.from("audio-buffer-bytes");

      await service.sendAudio({
        to: "919876543210",
        data: audioBuffer,
        ptt: true,
        mimetype: "audio/ogg; codecs=opus",
      });

      expect(transport.sendMediaMessage).toHaveBeenCalledWith(
        "919876543210@s.whatsapp.net",
        "audio",
        { data: audioBuffer },
        expect.objectContaining({ ptt: true, mimetype: "audio/ogg; codecs=opus" }),
      );
    });

    it("should reject missing audio file path", async () => {
      const transport = createMockTransport();
      const service = new MessageService(transport);

      await expect(
        service.sendAudio({
          to: "919876543210",
          path: "./non-existent-audio.mp3",
        }),
      ).rejects.toThrow(MessageError);
    });

    it("should reject empty audio file (0 bytes)", async () => {
      const transport = createMockTransport();
      const service = new MessageService(transport);

      const emptyPath = path.join(TEST_MEDIA_DIR, "empty.mp3");
      fs.writeFileSync(emptyPath, "");

      await expect(
        service.sendAudio({
          to: "919876543210",
          path: emptyPath,
        }),
      ).rejects.toThrow(MessageError);
    });

    it("should reject empty audio Buffer (0 bytes)", async () => {
      const transport = createMockTransport();
      const service = new MessageService(transport);

      await expect(
        service.sendAudio({
          to: "919876543210",
          data: Buffer.alloc(0),
        }),
      ).rejects.toThrow(MessageError);
    });

    it("should reject audio exceeding 100MB limit", async () => {
      const transport = createMockTransport();
      const service = new MessageService(transport);

      const hugeBuffer = Buffer.from("tiny");
      Object.defineProperty(hugeBuffer, "length", { value: 101 * 1024 * 1024 });

      await expect(
        service.sendAudio({
          to: "919876543210",
          data: hugeBuffer,
        }),
      ).rejects.toThrow(/exceeds maximum allowed size/);
    });
  });

  describe("sendDocument", () => {
    it("should send document from file path and default filename to basename", async () => {
      const transport = createMockTransport();
      const service = new MessageService(transport);

      const docPath = path.join(TEST_MEDIA_DIR, "report.pdf");
      fs.writeFileSync(docPath, Buffer.from("pdf-contents"));

      const res = await service.sendDocument({
        to: "919876543210",
        path: docPath,
        caption: "Monthly Report",
      });

      expect(res.id).toBe("media-123");
      expect(transport.sendMediaMessage).toHaveBeenCalledWith(
        "919876543210@s.whatsapp.net",
        "document",
        { path: docPath },
        expect.objectContaining({ filename: "report.pdf", caption: "Monthly Report" }),
      );
    });

    it("should send document from Buffer with custom filename", async () => {
      const transport = createMockTransport();
      const service = new MessageService(transport);
      const buffer = Buffer.from("csv-content");

      await service.sendDocument({
        to: "919876543210",
        data: buffer,
        filename: "data.csv",
        caption: "CSV Export",
      });

      expect(transport.sendMediaMessage).toHaveBeenCalledWith(
        "919876543210@s.whatsapp.net",
        "document",
        { data: buffer },
        expect.objectContaining({ filename: "data.csv", caption: "CSV Export" }),
      );
    });

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

    it("should reject missing document file path", async () => {
      const transport = createMockTransport();
      const service = new MessageService(transport);

      await expect(
        service.sendDocument({
          to: "919876543210",
          path: "./non-existent-doc.pdf",
        }),
      ).rejects.toThrow(MessageError);
    });

    it("should reject empty document file (0 bytes)", async () => {
      const transport = createMockTransport();
      const service = new MessageService(transport);

      const emptyPath = path.join(TEST_MEDIA_DIR, "empty.pdf");
      fs.writeFileSync(emptyPath, "");

      await expect(
        service.sendDocument({
          to: "919876543210",
          path: emptyPath,
        }),
      ).rejects.toThrow(MessageError);
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

    it("should reject when options is not an object", async () => {
      const transport = createMockTransport();
      const service = new MessageService(transport);

      await expect(
        service.sendDocument(null as unknown as Parameters<typeof service.sendDocument>[0]),
      ).rejects.toThrow(MessageError);
    });
  });
});
