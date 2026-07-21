import { prisma } from '../lib/prisma';
import { parseAisPositionReport } from '../lib/aisParser';
import { childLogger } from '../lib/logger';

const log = childLogger({ mod: 'ais' });

const AIS_URL = 'wss://stream.aisstream.io/v0/stream';

// SE-Asia bounding box (Petronas operating area). aisstream box format is
// [[[lat1, lon1], [lat2, lon2]], ...].
const DEFAULT_BOUNDING_BOXES: number[][][] = [[[0, 98], [8, 120]]];

// A busy box can emit many messages/sec per vessel; cap DB writes to at most
// one upsert per vessel per window so we store a live snapshot, not a firehose.
const WRITE_THROTTLE_MS = 30_000;
const lastWrite = new Map<number, number>();

// Reconnect with exponential backoff so a dropped socket self-heals.
const INITIAL_RECONNECT_MS = 1_000;
const MAX_RECONNECT_MS = 60_000;

// Node 24 ships a global WebSocket (undici). @types/node@22 doesn't type it as a
// global, so use a minimal structural type against globalThis rather than adding
// the `ws` dependency.
interface MinimalWebSocket {
  binaryType: string;
  send(data: string): void;
  close(): void;
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: (() => void) | null;
  onerror: ((event: unknown) => void) | null;
}
type WebSocketCtor = new (url: string) => MinimalWebSocket;

let reconnectDelay = INITIAL_RECONNECT_MS;

async function upsertPosition(raw: unknown): Promise<void> {
  const pos = parseAisPositionReport(raw);
  if (!pos) return;

  const now = Date.now();
  if (now - (lastWrite.get(pos.mmsi) ?? 0) < WRITE_THROTTLE_MS) return;
  lastWrite.set(pos.mmsi, now);

  await prisma.aisVesselPosition.upsert({
    where: { mmsi: pos.mmsi },
    create: { ...pos },
    update: { ...pos, receivedAt: new Date() },
  });
}

function connect(apiKey: string, boundingBoxes: number[][][]): void {
  const WebSocketImpl = (globalThis as { WebSocket?: WebSocketCtor }).WebSocket;
  if (!WebSocketImpl) {
    log.error('no global WebSocket available (needs Node >= 22); stream disabled');
    return;
  }

  const ws = new WebSocketImpl(AIS_URL);
  // aisstream delivers AIS messages as binary frames; take them as ArrayBuffers
  // so we can decode to text (the default 'blob' would stringify to "[object
  // Blob]" and every JSON.parse would fail — silently dropping all data).
  ws.binaryType = 'arraybuffer';

  ws.onopen = () => {
    reconnectDelay = INITIAL_RECONNECT_MS;
    // Subscription payload carries the API key — never log this object.
    ws.send(JSON.stringify({ APIKey: apiKey, BoundingBoxes: boundingBoxes, FilterMessageTypes: ['PositionReport'] }));
    log.info('connected and subscribed');
  };

  ws.onmessage = (event) => {
    const text =
      typeof event.data === 'string' ? event.data : new TextDecoder().decode(event.data as ArrayBuffer);
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      return; // ignore non-JSON frames
    }
    upsertPosition(raw).catch((err) => log.error({ err }, 'upsert error'));
  };

  ws.onerror = () => {
    // Do not log the error object — it can echo the request/subscription.
    log.error('socket error');
  };

  ws.onclose = () => {
    log.warn({ reconnectMs: reconnectDelay }, 'disconnected; reconnecting');
    setTimeout(() => connect(apiKey, boundingBoxes), reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_MS);
  };
}

/** Start the AIS ingestion stream. No-op (with a warning) if the key is missing. */
export function startAisStream(apiKey: string | undefined, boundingBoxes: number[][][] = DEFAULT_BOUNDING_BOXES): void {
  if (!apiKey) {
    log.warn('AISSTREAM_API_KEY not set; stream disabled');
    return;
  }
  connect(apiKey, boundingBoxes);
}

export function getLatestPositions(limit = 200) {
  return prisma.aisVesselPosition.findMany({ orderBy: { receivedAt: 'desc' }, take: limit });
}

export function getPositionsNear(latitude: number, longitude: number, radiusDeg = 2) {
  return prisma.aisVesselPosition.findMany({
    where: {
      latitude: { gte: latitude - radiusDeg, lte: latitude + radiusDeg },
      longitude: { gte: longitude - radiusDeg, lte: longitude + radiusDeg },
    },
    orderBy: { receivedAt: 'desc' },
    take: 200,
  });
}
