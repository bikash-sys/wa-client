import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { SessionStore } from "../src/auth/session-store.js";
import { SilentLogger } from "../src/utils/logger.js";

const TEST_BASE_DIR = path.resolve("./.temp/test-sessions");

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
