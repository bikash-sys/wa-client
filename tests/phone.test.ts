import { describe, it, expect } from "vitest";
import {
  cleanPhoneNumber,
  normalizePhoneNumber,
  toWhatsAppJid,
  jidToPhoneNumber,
  isWhatsAppJid,
  isGroupJid,
  isLidJid,
} from "../src/utils/phone.js";
import { InvalidPhoneNumberError } from "../src/errors/errors.js";

describe("Phone number utilities", () => {
  describe("cleanPhoneNumber", () => {
    it("should remove spaces, dashes, dots, parentheses, and leading plus sign", () => {
      expect(cleanPhoneNumber("+91 98765-43210")).toBe("919876543210");
      expect(cleanPhoneNumber("+1 (555) 234-5678")).toBe("15552345678");
      expect(cleanPhoneNumber("44.7123.456.789")).toBe("447123456789");
    });

    it("should throw InvalidPhoneNumberError on empty string", () => {
      expect(() => cleanPhoneNumber("")).toThrow(InvalidPhoneNumberError);
      expect(() => cleanPhoneNumber("   ")).toThrow(InvalidPhoneNumberError);
    });

    it("should throw InvalidPhoneNumberError if not a string", () => {
      // @ts-expect-error testing invalid runtime input
      expect(() => cleanPhoneNumber(null)).toThrow(InvalidPhoneNumberError);
      // @ts-expect-error testing invalid runtime input
      expect(() => cleanPhoneNumber(12345)).toThrow(InvalidPhoneNumberError);
    });
  });

  describe("normalizePhoneNumber", () => {
    it("should normalize valid international numbers with country codes", () => {
      expect(normalizePhoneNumber("+919876543210")).toBe("919876543210");
      expect(normalizePhoneNumber("919876543210")).toBe("919876543210");
      expect(normalizePhoneNumber("+15552345678")).toBe("15552345678");
    });

    it("should extract phone number from full user JID", () => {
      expect(normalizePhoneNumber("919876543210@s.whatsapp.net")).toBe("919876543210");
      expect(normalizePhoneNumber("919876543210:2@s.whatsapp.net")).toBe("919876543210");
    });

    it("should pass through valid group JIDs", () => {
      expect(normalizePhoneNumber("123456789-987654@g.us")).toBe("123456789-987654@g.us");
    });

    it("should reject non-numeric characters", () => {
      expect(() => normalizePhoneNumber("91987abc3210")).toThrow(InvalidPhoneNumberError);
      expect(() => normalizePhoneNumber("hello")).toThrow(InvalidPhoneNumberError);
    });

    it("should reject numbers that are too short (< 7 digits)", () => {
      expect(() => normalizePhoneNumber("12345")).toThrow(InvalidPhoneNumberError);
    });

    it("should reject numbers that are too long (> 15 digits)", () => {
      expect(() => normalizePhoneNumber("123456789012345678")).toThrow(InvalidPhoneNumberError);
    });
  });

  describe("toWhatsAppJid", () => {
    it("should append @s.whatsapp.net for user phone numbers", () => {
      expect(toWhatsAppJid("+91 98765-43210")).toBe("919876543210@s.whatsapp.net");
      expect(toWhatsAppJid("15552345678")).toBe("15552345678@s.whatsapp.net");
    });

    it("should preserve group JIDs", () => {
      expect(toWhatsAppJid("123456-7890@g.us")).toBe("123456-7890@g.us");
    });
  });

  describe("jidToPhoneNumber", () => {
    it("should strip @s.whatsapp.net", () => {
      expect(jidToPhoneNumber("919876543210@s.whatsapp.net")).toBe("919876543210");
      expect(jidToPhoneNumber("919876543210:1@s.whatsapp.net")).toBe("919876543210");
    });

    it("should return unchanged for non-user JIDs", () => {
      expect(jidToPhoneNumber("12345-6789@g.us")).toBe("12345-6789@g.us");
      expect(jidToPhoneNumber("919876543210")).toBe("919876543210");
    });
  });

  describe("isWhatsAppJid, isGroupJid, isLidJid", () => {
    it("should identify user JIDs", () => {
      expect(isWhatsAppJid("919876543210@s.whatsapp.net")).toBe(true);
      expect(isGroupJid("919876543210@s.whatsapp.net")).toBe(false);
      expect(isLidJid("919876543210@s.whatsapp.net")).toBe(false);
    });

    it("should identify group JIDs", () => {
      expect(isWhatsAppJid("12345-67890@g.us")).toBe(true);
      expect(isGroupJid("12345-67890@g.us")).toBe(true);
      expect(isLidJid("12345-67890@g.us")).toBe(false);
    });

    it("should identify LID JIDs", () => {
      expect(isWhatsAppJid("1234567890@lid")).toBe(true);
      expect(isGroupJid("1234567890@lid")).toBe(false);
      expect(isLidJid("1234567890@lid")).toBe(true);
    });

    it("should normalize and preserve LID and newsletter JIDs", () => {
      expect(normalizePhoneNumber("1234567890@lid")).toBe("1234567890@lid");
      expect(toWhatsAppJid("1234567890@lid")).toBe("1234567890@lid");
      expect(jidToPhoneNumber("1234567890:1@lid")).toBe("1234567890");

      expect(normalizePhoneNumber("1234567890@newsletter")).toBe("1234567890@newsletter");
      expect(toWhatsAppJid("1234567890@newsletter")).toBe("1234567890@newsletter");
    });

    it("should return false for plain phone numbers", () => {
      expect(isWhatsAppJid("919876543210")).toBe(false);
      expect(isGroupJid("919876543210")).toBe(false);
      expect(isLidJid("919876543210")).toBe(false);
    });
  });
});
