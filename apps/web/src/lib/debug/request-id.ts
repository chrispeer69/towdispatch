/**
 * [FLEET_DEBUG] — temporary per-render correlation id.
 *
 * React.cache() is per-request-scoped on the server, so the same id is
 * returned for every call within a single render of a single route segment.
 * That lets us correlate interleaved log lines in Railway when multiple
 * users hit the app at once.
 *
 * Remove together with the rest of the [FLEET_DEBUG] instrumentation once
 * the /fleet bounce is understood and fixed.
 */
import { cache } from 'react';

export const getRequestId = cache((): string => Math.random().toString(36).slice(2, 10));
