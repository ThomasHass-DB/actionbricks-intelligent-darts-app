/**
 * KinesisConnectionPool — singleton that caches WebRTC sessions across
 * page navigations.  Components call `acquire(channelName)` to get a
 * MediaStream and `release(channelName)` when they unmount.
 *
 * Sessions are kept alive for a grace period (default 10s) after the last
 * consumer releases them, so navigating between pages reuses the same
 * connection instead of re-establishing it every time.
 */

import { getKinesisViewerConfig } from "./api";
import { connectAsViewer, type KinesisViewerSession } from "./kinesis-webrtc";

interface PoolEntry {
  session: KinesisViewerSession;
  refCount: number;
  /** Timer that closes the session after the grace period. */
  graceTimer: ReturnType<typeof setTimeout> | null;
  /** Promise that resolves when the session is ready (for dedup). */
  connectPromise: Promise<KinesisViewerSession> | null;
}

/** How long (ms) to keep an unused session alive before closing it. */
const GRACE_PERIOD_MS = 30_000;

const pool = new Map<string, PoolEntry>();

/**
 * Acquire a MediaStream for the given channel.  If a session already exists
 * in the pool, its reference count is bumped and the existing stream is
 * returned immediately (no reconnection delay).
 */
export async function acquire(channelName: string): Promise<MediaStream> {
  const existing = pool.get(channelName);

  if (existing) {
    // Cancel any pending grace-period close
    if (existing.graceTimer) {
      clearTimeout(existing.graceTimer);
      existing.graceTimer = null;
    }

    existing.refCount++;
    console.log(
      `[kinesis-pool] Reusing session for "${channelName}" (refCount=${existing.refCount})`,
    );

    // If still connecting, wait for it
    if (existing.connectPromise) {
      const session = await existing.connectPromise;
      return session.remoteStream;
    }

    return existing.session.remoteStream;
  }

  // Create new entry — start connecting
  const entry: PoolEntry = {
    session: null!,
    refCount: 1,
    graceTimer: null,
    connectPromise: null,
  };
  pool.set(channelName, entry);

  console.log(`[kinesis-pool] Creating new session for "${channelName}"`);

  const connectPromise = (async () => {
    const { data: info } = await getKinesisViewerConfig({
      channel_name: channelName,
    });
    const session = await connectAsViewer(info, `pool-${channelName}`);
    return session;
  })();

  entry.connectPromise = connectPromise;

  try {
    const session = await connectPromise;
    entry.session = session;
    entry.connectPromise = null;

    // If everyone released while we were connecting, start the grace timer
    if (entry.refCount <= 0) {
      startGraceTimer(channelName, entry);
    }

    return session.remoteStream;
  } catch (err) {
    // Connection failed — remove from pool so next acquire retries
    pool.delete(channelName);
    throw err;
  }
}

/**
 * Release a reference to the channel.  When the last consumer releases,
 * the session is kept alive for a grace period before being closed.
 */
export function release(channelName: string): void {
  const entry = pool.get(channelName);
  if (!entry) return;

  entry.refCount = Math.max(0, entry.refCount - 1);
  console.log(
    `[kinesis-pool] Released "${channelName}" (refCount=${entry.refCount})`,
  );

  if (entry.refCount <= 0 && !entry.graceTimer) {
    startGraceTimer(channelName, entry);
  }
}

/**
 * Force-close a specific channel session (e.g. when channel name changes).
 */
export function closeChannel(channelName: string): void {
  const entry = pool.get(channelName);
  if (!entry) return;

  if (entry.graceTimer) clearTimeout(entry.graceTimer);
  entry.session?.close();
  pool.delete(channelName);
  console.log(`[kinesis-pool] Force-closed "${channelName}"`);
}

/**
 * Close all sessions (e.g. on app shutdown or mode change).
 */
export function closeAll(): void {
  for (const [channelName, entry] of pool) {
    if (entry.graceTimer) clearTimeout(entry.graceTimer);
    entry.session?.close();
    console.log(`[kinesis-pool] Closed "${channelName}"`);
  }
  pool.clear();
}

/**
 * Check if a session exists and is connected for the given channel.
 */
export function hasSession(channelName: string): boolean {
  const entry = pool.get(channelName);
  return !!entry && !!entry.session && !entry.connectPromise;
}

// ── Internal ────────────────────────────────────────────────────────────────

function startGraceTimer(channelName: string, entry: PoolEntry): void {
  entry.graceTimer = setTimeout(() => {
    // Double-check no one re-acquired during the grace period
    if (entry.refCount <= 0) {
      entry.session?.close();
      pool.delete(channelName);
      console.log(
        `[kinesis-pool] Grace period expired — closed "${channelName}"`,
      );
    }
    entry.graceTimer = null;
  }, GRACE_PERIOD_MS);
}
