import { InvalidPhoneNumberError } from "../errors/errors.js";

const WHATSAPP_USER_DOMAIN = "@s.whatsapp.net";
const WHATSAPP_GROUP_DOMAIN = "@g.us";

/**
 * Checks whether an input string is already formatted as a WhatsApp JID.
 */
export function isWhatsAppJid(input: string): boolean {
  if (typeof input !== "string") return false;
  return input.endsWith(WHATSAPP_USER_DOMAIN) || input.endsWith(WHATSAPP_GROUP_DOMAIN);
}

/**
 * Checks whether a JID belongs to a WhatsApp group.
 */
export function isGroupJid(jid: string): boolean {
  if (typeof jid !== "string") return false;
  return jid.endsWith(WHATSAPP_GROUP_DOMAIN);
}

/**
 * Strips formatting characters (spaces, dashes, parentheses, dots, leading plus sign)
 * from a phone number string.
 */
export function cleanPhoneNumber(input: string): string {
  if (typeof input !== "string") {
    throw new InvalidPhoneNumberError(
      `Phone number must be a string, received: ${typeof input}`,
      "ERR_INVALID_PHONE_TYPE",
    );
  }

  const trimmed = input.trim();
  if (!trimmed) {
    throw new InvalidPhoneNumberError("Phone number cannot be empty", "ERR_EMPTY_PHONE_NUMBER");
  }

  // Remove leading '+' if present
  let sanitized = trimmed.startsWith("+") ? trimmed.slice(1) : trimmed;

  // Remove common delimiter characters: spaces, dashes, parentheses, dots
  sanitized = sanitized.replace(/[\s\-().]/g, "");

  return sanitized;
}

/**
 * Validates and normalizes a phone number into canonical E.164 digits without '+'.
 * Rejects numbers containing non-digit characters, or numbers outside standard
 * international phone length (7-15 digits).
 *
 * Note: Country code MUST be included. WhatsApp cannot deliver messages to local numbers.
 */
export function normalizePhoneNumber(input: string): string {
  // If it's already a group JID, validate the group format
  if (typeof input === "string" && input.endsWith(WHATSAPP_GROUP_DOMAIN)) {
    const groupId = input.slice(0, -WHATSAPP_GROUP_DOMAIN.length);
    if (!groupId || !/^[0-9-]+$/.test(groupId)) {
      throw new InvalidPhoneNumberError(
        `Invalid group identifier: "${input}"`,
        "ERR_INVALID_GROUP_JID",
      );
    }
    return input;
  }

  // If it's already a user JID, extract the phone part
  let target = input;
  if (typeof target === "string" && target.endsWith(WHATSAPP_USER_DOMAIN)) {
    target = target.slice(0, -WHATSAPP_USER_DOMAIN.length);
    // User JID might have a device suffix, e.g. "123456789:1"
    if (target.includes(":")) {
      target = target.split(":")[0] ?? target;
    }
  }

  const cleaned = cleanPhoneNumber(target);

  // Check that all remaining characters are digits
  if (!/^\d+$/.test(cleaned)) {
    throw new InvalidPhoneNumberError(
      `Phone number "${input}" contains invalid characters. Only digits are allowed. Include the country code without spaces or symbols.`,
      "ERR_INVALID_PHONE_CHARACTERS",
    );
  }

  // E.164 standard: minimum 7 digits, maximum 15 digits
  if (cleaned.length < 7 || cleaned.length > 15) {
    throw new InvalidPhoneNumberError(
      `Phone number "${input}" has an invalid length (${cleaned.length} digits). Standard international phone numbers require between 7 and 15 digits with the country code.`,
      "ERR_INVALID_PHONE_LENGTH",
    );
  }

  return cleaned;
}

/**
 * Converts a phone number or JID into a canonical WhatsApp JID format.
 *
 * Example:
 *   "+919876543210" -> "919876543210@s.whatsapp.net"
 *   "919876543210"  -> "919876543210@s.whatsapp.net"
 *   "12345-67890@g.us" -> "12345-67890@g.us"
 */
export function toWhatsAppJid(input: string): string {
  if (typeof input === "string" && input.endsWith(WHATSAPP_GROUP_DOMAIN)) {
    normalizePhoneNumber(input); // Validate
    return input;
  }

  const normalized = normalizePhoneNumber(input);
  return `${normalized}${WHATSAPP_USER_DOMAIN}`;
}

/**
 * Extracts the raw phone number from a WhatsApp JID.
 * Returns the original string if not a user JID.
 */
export function jidToPhoneNumber(jid: string): string {
  if (typeof jid !== "string") return "";
  if (jid.endsWith(WHATSAPP_USER_DOMAIN)) {
    const raw = jid.slice(0, -WHATSAPP_USER_DOMAIN.length);
    return raw.includes(":") ? (raw.split(":")[0] ?? raw) : raw;
  }
  return jid;
}
