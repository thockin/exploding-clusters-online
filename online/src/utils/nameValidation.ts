/**
 * Validates and sanitizes player names
 * - Maximum length: 32 characters
 * - Escapes HTML to prevent XSS
 * - Trims whitespace
 */

const MAX_NAME_LENGTH = 32;

/**
 * Escapes HTML special characters to prevent XSS attacks
 */
export function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  };
  return text.replace(/[&<>"']/g, (char) => map[char]);
}

/**
 * Validates a player name
 * @param name - The name to validate
 * @returns Object with isValid flag and error message if invalid
 */
export function validatePlayerName(name: string): { isValid: boolean; error?: string; sanitized?: string } {
  if (!name || typeof name !== 'string') {
    return { isValid: false, error: 'Name is required' };
  }

  // Trim whitespace
  const trimmed = name.trim();

  if (trimmed.length === 0) {
    return { isValid: false, error: 'Name cannot be empty' };
  }

  if (trimmed.length > MAX_NAME_LENGTH) {
    return { isValid: false, error: `Name must be ${MAX_NAME_LENGTH} characters or less` };
  }

  // Escape the name
  const escaped = escapeHtml(trimmed);

  // If escaping changed the name, it contained HTML/script tags - reject it
  if (escaped !== trimmed) {
    return { isValid: false, error: 'Name contains invalid characters' };
  }

  return { isValid: true, sanitized: trimmed };
}

/**
 * Sanitizes a player name for display (server-side)
 * This should be used when storing/displaying names that have already been validated
 */
export function sanitizePlayerName(name: string): string {
  if (!name || typeof name !== 'string') {
    return '';
  }
  const trimmed = name.trim();
  if (trimmed.length > MAX_NAME_LENGTH) {
    return trimmed.substring(0, MAX_NAME_LENGTH);
  }
  return trimmed;
}

/**
 * Normalizes a name for comparison (trim + lowercase)
 * Used for case-insensitive name comparisons
 */
export function normalizeNameForComparison(name: string): string {
  if (!name || typeof name !== 'string') {
    return '';
  }
  return name.trim().toLowerCase();
}

