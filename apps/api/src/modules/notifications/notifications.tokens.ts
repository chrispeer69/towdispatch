/**
 * Injection tokens for the notifications module. Kept in their own file so
 * channel adapters and workers can import them without dragging the whole
 * module graph.
 */
export const QUEUE_ADAPTER = Symbol('NOTIFICATIONS_QUEUE_ADAPTER');

export const CHANNEL_ADAPTERS = Symbol('NOTIFICATIONS_CHANNEL_ADAPTERS');

export const NOTIFICATION_DEFAULTS = Symbol('NOTIFICATION_DEFAULTS');
