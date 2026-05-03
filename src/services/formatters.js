/**
 * Shared formatting utilities for the frontend.
 * Centralizes phone, currency, date, and name formatting
 * that was previously scattered across page components.
 */

/**
 * Format a phone number for display.
 * Adds +65 prefix for 8-digit Singapore numbers, formats with spaces.
 */
export function formatPhone(phone) {
 if (!phone) return '';
 let p = String(phone).replace(/\s+/g, '');

 // Add +65 for bare 8-digit SG numbers
 if (/^\d{8}$/.test(p) && /^[3689]/.test(p)) {
 p = `+65${p}`;
 }
 // Add + if missing for numbers starting with country code
 if (/^\d{10,15}$/.test(p)) {
 p = `+${p}`;
 }

 // Format: +65 8123 4567
 if (p.startsWith('+65') && p.length === 11) {
 return `+65 ${p.slice(3, 7)} ${p.slice(7)}`;
 }
 return p;
}

/**
 * Build a WhatsApp link for a phone number.
 */
export function whatsappLink(phone, message = '') {
 const digits = String(phone).replace(/[^0-9]/g, '');
 const base = `https://wa.me/${digits}`;
 return message ? `${base}?text=${encodeURIComponent(message)}` : base;
}

/**
 * Format currency (SGD by default).
 */
export function formatCurrency(amount, currency = 'SGD') {
 const num = parseFloat(amount);
 if (isNaN(num)) return '$0.00';
 return new Intl.NumberFormat('en-SG', { style: 'currency', currency }).format(num);
}

/**
 * Format a date for display. Returns relative or absolute based on recency.
 */
export function formatDate(date, options = {}) {
 if (!date) return '';
 const d = new Date(date);
 if (isNaN(d.getTime())) return '';

 if (options.relative) {
 const now = new Date();
 const diffMs = now - d;
 const diffMins = Math.floor(diffMs / 60000);
 const diffHours = Math.floor(diffMs / 3600000);
 const diffDays = Math.floor(diffMs / 86400000);

 if (diffMins < 1) return 'just now';
 if (diffMins < 60) return `${diffMins}m ago`;
 if (diffHours < 24) return `${diffHours}h ago`;
 if (diffDays < 7) return `${diffDays}d ago`;
 }

 return d.toLocaleDateString('en-SG', {
 day: 'numeric',
 month: 'short',
 year: 'numeric',
 ...options,
 });
}

/**
 * Format a user's full name from parts.
 */
export function formatName(user) {
 if (!user) return '';
 if (user.fullName || user.full_name) return user.fullName || user.full_name;
 return [user.firstName, user.lastName].filter(Boolean).join(' ').trim() || user.email || '';
}

/**
 * Normalize a list response — handles both array and {key: [...]} shapes.
 */
export function normalizeList(data, key) {
 if (Array.isArray(data)) return data;
 if (data && Array.isArray(data[key])) return data[key];
 return [];
}
