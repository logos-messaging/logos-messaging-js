import { TypedEventEmitter } from "@libp2p/interface";
import { delay, MockWakuEvents, MockWakuNode } from "@waku/utils";

import { ReliableChannel } from "./reliable_channel.js";

export const TEST_CONSTANTS = {
  POLL_INTERVAL_MS: 50,
  RETRY_INTERVAL_MS: 300
} as const;

/**
 * Wait for a condition to become truthy, with timeout
 * @param condition Function that returns the value when ready, or undefined while waiting
 * @param timeoutMs Maximum time to wait before throwing
 * @returns The value returned by condition
 * @throws Error if timeout is reached
 */
export async function waitFor<T>(
  condition: () => T | undefined,
  timeoutMs = 5000
): Promise<T> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(
        `Timeout after ${timeoutMs}ms waiting for condition to be met`
      );
    }
    await delay(TEST_CONSTANTS.POLL_INTERVAL_MS);
  }
  return condition()!;
}

/**
 * Send a message and wait for the "message-sent" event
 * @param channel The ReliableChannel to send from
 * @param message The message payload to send
 */
export async function sendAndWaitForEvent(
  channel: ReliableChannel<any>,
  message: Uint8Array
): Promise<void> {
  return new Promise((resolve) => {
    const handler = (): void => {
      channel.removeEventListener("message-sent", handler);
      resolve();
    };
    channel.addEventListener("message-sent", handler);
    channel.send(message);
  });
}

/**
 * Create a common event emitter and two mock Waku nodes
 * @returns Object containing the emitter and two mock nodes (alice and bob)
 */
export function createMockNodes(): {
  emitter: TypedEventEmitter<MockWakuEvents>;
  alice: MockWakuNode;
  bob: MockWakuNode;
} {
  const emitter = new TypedEventEmitter<MockWakuEvents>();
  return {
    emitter,
    alice: new MockWakuNode(emitter),
    bob: new MockWakuNode(emitter)
  };
}
