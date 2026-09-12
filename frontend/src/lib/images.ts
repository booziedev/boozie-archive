/**
 * Shared limits for picking an image to upload.
 *
 * The server decides what a file really is from its magic bytes, so these are
 * only here to catch an obvious mistake before it costs a round trip. They
 * match AVATAR_MAX_BYTES and the accepted signatures in
 * backend/src/lib/images.ts — the server is still the authority.
 */

/** MIME types the file chooser offers, and the ones the server accepts. */
export const ACCEPTED_IMAGES = 'image/png,image/jpeg,image/gif,image/webp';

/** Matches AVATAR_MAX_BYTES on the server. Animated GIFs get sizeable. */
export const MAX_IMAGE_MB = 5;
