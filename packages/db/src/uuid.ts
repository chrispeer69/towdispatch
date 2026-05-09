/**
 * Single re-export of UUIDv7 generation. Centralized so we can swap the
 * implementation without touching call sites.
 */
import { uuidv7 as gen } from 'uuidv7';

export const uuidv7 = (): string => gen();
