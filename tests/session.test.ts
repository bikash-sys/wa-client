import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { WhatsApp } from "../src/client.js";
import { SessionStore, validateSessionName } from "../src/auth/session-store.js";
import { SessionError } from "../src/errors/errors.js";
import { SilentLogger } from "../src/utils/logger.js";
import { TypedEventEmitter } from "../src/events/event-emitter.js";
import type { WhatsAppTransport, TransportEvents } from "../src/transport/transport.interface.js";
import type { ConnectionState } from "../src/types/index.js";

const TEST_BASE_DIR = path.resolve("./.temp/test-sessions");

class MockTransport extends TypedEventEmitter<TransportEvents> implements WhatsAppTransport {
  private state: ConnectionState = "disconnected";
  public mockSocket = { tag: "mock-baileys-socket" };

  public connect = vi.fn().mockImplementation(async () => {
    this.state = "connected";
    this.emit("connected");
    this.emit("ready");
  });

  public disconnect = vi.fn().mockImplementation(async () => {
    this.state = "disconnected";
    this.emit("disconnected", "client closed", false);
  });

  public logout = vi.fn().mockImplementation(async () => {
    this.state = "logged_out";
    this.emit("logged_out");
  });

  public destroy = vi.fn().mockImplementation(async () => {
    await this.disconnect();
    this.removeAllListeners();
  });

  public isConnected = vi.fn().mockImplementation(() => this.state === "connected");
  public getState = vi.fn().mockImplementation(() => this.state);

  public sendTextMessage = vi.fn().mockResolvedValue({
    id: "sent-1",
    to: "919876543210",
    timestamp: Date.now(),
  });

  public sendMediaMessage = vi.fn().mockResolvedValue({
    id: "sent-2",
    to: "919876543210",
    timestamp: Date.now(),
  });

  public getRawClient<T = unknown>(): T | undefined {
    return this.mockSocket as unknown as T;
  }
}

describe("SessionStore", () => {
  beforeEach(() => {
    fs.rmSync(TEST_BASE_DIR, { recursive: true, force: true });
    fs.mkdirSync(TEST_BASE_DIR, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(TEST_BASE_DIR, { recursive: true, force: true });
  });

  it("should create directory if it does not exist", () => {
    const sessionDir = path.join(TEST_BASE_DIR, "session-1");
    const store = new SessionStore(sessionDir, new SilentLogger());

    expect(fs.existsSync(sessionDir)).toBe(false);
    store.ensureDirectory();
    expect(fs.existsSync(sessionDir)).toBe(true);
    expect(fs.statSync(sessionDir).isDirectory()).toBe(true);
  });

  it("should detect whether credentials exist", () => {
    const sessionDir = path.join(TEST_BASE_DIR, "session-creds");
    const store = new SessionStore(sessionDir, new SilentLogger());

    store.ensureDirectory();
    expect(store.hasCredentials()).toBe(false);

    // Create a mock creds.json
    fs.writeFileSync(
      path.join(sessionDir, "creds.json"),
      JSON.stringify({ me: { id: "919876543210:1@s.whatsapp.net" } }),
    );

    expect(store.hasCredentials()).toBe(true);
  });

  it("should detect corrupted session files", () => {
    const sessionDir = path.join(TEST_BASE_DIR, "session-corrupt");
    const store = new SessionStore(sessionDir, new SilentLogger());

    store.ensureDirectory();

    // Empty or malformed creds.json
    fs.writeFileSync(path.join(sessionDir, "creds.json"), "invalid-json{{{");
    expect(store.isCorrupt()).toBe(true);

    // Auto-recovers on validate()
    store.validate();
    expect(fs.existsSync(path.join(sessionDir, "creds.json"))).toBe(false);
  });

  it("should clear session directory completely on clear()", () => {
    const sessionDir = path.join(TEST_BASE_DIR, "session-clear");
    const store = new SessionStore(sessionDir, new SilentLogger());

    store.ensureDirectory();
    fs.writeFileSync(path.join(sessionDir, "creds.json"), "{}");
    fs.writeFileSync(path.join(sessionDir, "pre-key-1.json"), "{}");

    expect(fs.readdirSync(sessionDir).length).toBe(2);

    store.clear();

    expect(fs.readdirSync(sessionDir).length).toBe(0);
  });

  it("should completely remove directory on destroyDirectory()", () => {
    const sessionDir = path.join(TEST_BASE_DIR, "session-destroy");
    const store = new SessionStore(sessionDir, new SilentLogger());

    store.ensureDirectory();
    fs.writeFileSync(path.join(sessionDir, "creds.json"), "{}");
    expect(fs.existsSync(sessionDir)).toBe(true);

    store.destroyDirectory();
    expect(fs.existsSync(sessionDir)).toBe(false);
  });

  it("should maintain multiple independent sessions without collision", () => {
    const sessionDir1 = path.join(TEST_BASE_DIR, "account-1");
    const sessionDir2 = path.join(TEST_BASE_DIR, "account-2");

    const store1 = new SessionStore(sessionDir1, new SilentLogger());
    const store2 = new SessionStore(sessionDir2, new SilentLogger());

    store1.ensureDirectory();
    store2.ensureDirectory();

    fs.writeFileSync(
      path.join(sessionDir1, "creds.json"),
      JSON.stringify({ me: { id: "1111111111@s.whatsapp.net" } }),
    );
    fs.writeFileSync(
      path.join(sessionDir2, "creds.json"),
      JSON.stringify({ me: { id: "2222222222@s.whatsapp.net" } }),
    );

    expect(store1.hasCredentials()).toBe(true);
    expect(store2.hasCredentials()).toBe(true);

    store1.clear();

    expect(store1.hasCredentials()).toBe(false);
    expect(store2.hasCredentials()).toBe(true);
  });
});

describe("Named Session Validation & Path Traversal Protection", () => {
  it("should validate and accept valid session names", () => {
    expect(validateSessionName("personal")).toBe("personal");
    expect(validateSessionName("business")).toBe("business");
    expect(validateSessionName("bot_1")).toBe("bot_1");
    expect(validateSessionName("customer-support")).toBe("customer-support");
    expect(validateSessionName("default")).toBe("default");
  });

  it("should reject unsafe session names with path traversal characters", () => {
    expect(() => validateSessionName("")).toThrow(SessionError);
    expect(() => validateSessionName("   ")).toThrow(SessionError);
    expect(() => validateSessionName(".")).toThrow(SessionError);
    expect(() => validateSessionName("..")).toThrow(SessionError);
    expect(() => validateSessionName("../something")).toThrow(SessionError);
    expect(() => validateSessionName("../../auth")).toThrow(SessionError);
    expect(() => validateSessionName("/etc/passwd")).toThrow(SessionError);
    expect(() => validateSessionName("foo/bar")).toThrow(SessionError);
    expect(() => validateSessionName("foo\\bar")).toThrow(SessionError);
    expect(() => validateSessionName("foo\0bar")).toThrow(SessionError);
    expect(() => validateSessionName("session*name")).toThrow(SessionError);
  });
});

describe("Named Sessions & Session Management API", () => {
  beforeEach(() => {
    fs.rmSync(TEST_BASE_DIR, { recursive: true, force: true });
    fs.mkdirSync(TEST_BASE_DIR, { recursive: true });
  });

  afterEach(async () => {
    await WhatsApp.disconnectAll();
    fs.rmSync(TEST_BASE_DIR, { recursive: true, force: true });
  });

  it("should default to 'default' session name and ./auth root directory", () => {
    const wa = new WhatsApp({ logger: false });
    expect(wa.session).toBe("default");
    expect(wa.sessionName).toBe("default");
    expect(wa.authDir).toBe("./auth");
    expect(wa.sessionPath).toBe(path.resolve("./auth/default"));
  });

  it("should automatically resolve session directory as ${authDir}/${session}", () => {
    const wa = new WhatsApp({
      authDir: TEST_BASE_DIR,
      session: "business",
      logger: false,
    });

    expect(wa.session).toBe("business");
    expect(wa.authDir).toBe(TEST_BASE_DIR);
    expect(wa.sessionPath).toBe(path.join(TEST_BASE_DIR, "business"));
  });

  it("should create named session via WhatsApp.createSession()", async () => {
    const wa = await WhatsApp.createSession("personal", {
      authDir: TEST_BASE_DIR,
      logger: false,
    });

    expect(wa.session).toBe("personal");
    expect(WhatsApp.getSession("personal", TEST_BASE_DIR)).toBe(wa);
  });

  it("should list sessions on disk and in memory via WhatsApp.listSessions()", async () => {
    // 1. Create a session on disk manually
    const diskSessionDir = path.join(TEST_BASE_DIR, "archived");
    fs.mkdirSync(diskSessionDir, { recursive: true });
    fs.writeFileSync(path.join(diskSessionDir, "creds.json"), JSON.stringify({ me: "123" }));

    // 2. Create an active session in memory with MockTransport
    const transport = new MockTransport();
    const activeClient = new WhatsApp({
      session: "active-bot",
      authDir: TEST_BASE_DIR,
      transport,
      logger: false,
    });
    await activeClient.connect();

    // 3. List sessions
    const sessions = await WhatsApp.listSessions(TEST_BASE_DIR);

    expect(sessions.length).toBe(2);

    const activeInfo = sessions.find((s) => s.name === "active-bot");
    expect(activeInfo).toBeDefined();
    expect(activeInfo?.connected).toBe(true);
    expect(activeInfo?.state).toBe("connected");

    const archivedInfo = sessions.find((s) => s.name === "archived");
    expect(archivedInfo).toBeDefined();
    expect(archivedInfo?.connected).toBe(false);
    expect(archivedInfo?.hasCredentials).toBe(true);
  });

  it("should check session existence with WhatsApp.hasSession()", () => {
    const sessionDir = path.join(TEST_BASE_DIR, "existing");
    fs.mkdirSync(sessionDir, { recursive: true });

    expect(WhatsApp.hasSession("existing", TEST_BASE_DIR)).toBe(true);
    expect(WhatsApp.hasSession("non-existent", TEST_BASE_DIR)).toBe(false);
  });

  it("should remove session and clean up disk and memory via removeSession()", async () => {
    const transport = new MockTransport();
    const wa = new WhatsApp({
      session: "to-remove",
      authDir: TEST_BASE_DIR,
      transport,
      logger: false,
    });
    await wa.connect();

    const sessionDir = path.join(TEST_BASE_DIR, "to-remove");
    fs.mkdirSync(sessionDir, { recursive: true });
    fs.writeFileSync(path.join(sessionDir, "creds.json"), "{}");

    const removeSpy = vi.fn();
    wa.on("session.removed", removeSpy);

    await WhatsApp.removeSession("to-remove", { authDir: TEST_BASE_DIR });

    expect(transport.destroy).toHaveBeenCalled();
    expect(removeSpy).toHaveBeenCalledWith("to-remove");
    expect(fs.existsSync(sessionDir)).toBe(false);
    expect(WhatsApp.getSession("to-remove", TEST_BASE_DIR)).toBeUndefined();
  });

  it("should leave other sessions untouched when removing a specific session", async () => {
    const dir1 = path.join(TEST_BASE_DIR, "personal");
    const dir2 = path.join(TEST_BASE_DIR, "business");
    const dir3 = path.join(TEST_BASE_DIR, "bot");

    fs.mkdirSync(dir1, { recursive: true });
    fs.mkdirSync(dir2, { recursive: true });
    fs.mkdirSync(dir3, { recursive: true });

    await WhatsApp.removeSession("business", { authDir: TEST_BASE_DIR });

    expect(fs.existsSync(dir1)).toBe(true);
    expect(fs.existsSync(dir2)).toBe(false);
    expect(fs.existsSync(dir3)).toBe(true);
  });

  it("should support instance methods for session management", async () => {
    const wa = new WhatsApp({
      session: "instance-test",
      authDir: TEST_BASE_DIR,
      logger: false,
    });

    const otherDir = path.join(TEST_BASE_DIR, "other-session");
    fs.mkdirSync(otherDir, { recursive: true });

    expect(wa.hasSession("other-session")).toBe(true);

    const sessions = await wa.listSessions();
    expect(sessions.some((s) => s.name === "instance-test")).toBe(true);
    expect(sessions.some((s) => s.name === "other-session")).toBe(true);

    await wa.removeSession("other-session");
    expect(fs.existsSync(otherDir)).toBe(false);
  });

  it("should auto-connect and send when persistent credentials exist on disk without QR code", async () => {
    const sessionDir = path.join(TEST_BASE_DIR, "persistent-acc");
    fs.mkdirSync(sessionDir, { recursive: true });
    fs.writeFileSync(
      path.join(sessionDir, "creds.json"),
      JSON.stringify({ me: { id: "919340748552:1@s.whatsapp.net" } }),
    );

    const transport = new MockTransport();
    const qrSpy = vi.fn();
    const readySpy = vi.fn();

    const wa = new WhatsApp({
      session: "persistent-acc",
      authDir: TEST_BASE_DIR,
      transport,
      logger: false,
    });

    wa.on("qr", qrSpy);
    wa.on("ready", readySpy);

    const result = await wa.send("919340748552", "Hello from saved session!");

    expect(qrSpy).not.toHaveBeenCalled();
    expect(readySpy).toHaveBeenCalledTimes(1);
    expect(transport.connect).toHaveBeenCalledTimes(1);
    expect(result.id).toBe("sent-1");
  });
});
