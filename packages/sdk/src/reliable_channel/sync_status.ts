import { TypedEventEmitter } from "@libp2p/interface";
import { MessageId } from "@waku/sds";
import { Logger } from "@waku/utils";

const log = new Logger("sds:sync-status");

export const StatusEvent = {
  /**
   * We are not aware of any missing messages that we may be able to get
   * We MAY have messages lost forever, see the `event.detail`
   */
  Synced: "synced", // TODO or synced or health or caught-up?
  /**
   * We are aware of missing messages that we may be able to get
   */
  Syncing: "syncing" // TODO: it assumes "syncing" is happening via SDS repair or store queries
};

export type StatusEvent = (typeof StatusEvent)[keyof typeof StatusEvent];

export type StatusDetail = {
  /**
   * number of received messages
   */
  received: number;
  /**
   * number of missing messages that are not yet considered as irretrievably lost
   */
  missing: number;
  /**
   * number of messages considered as irretrievably lost
   */
  lost: number;
};

export interface StatusEvents {
  synced: CustomEvent<StatusDetail>;
  syncing: CustomEvent<StatusDetail>;
}

/**
 * Read-only interface for sync status events.
 * Only exposes event listener methods, hiding internal state management.
 */
export interface ISyncStatusEvents {
  addEventListener(
    event: "synced",
    callback: (e: CustomEvent<StatusDetail>) => void
  ): void;
  addEventListener(
    event: "syncing",
    callback: (e: CustomEvent<StatusDetail>) => void
  ): void;
  removeEventListener(
    event: "synced",
    callback: (e: CustomEvent<StatusDetail>) => void
  ): void;
  removeEventListener(
    event: "syncing",
    callback: (e: CustomEvent<StatusDetail>) => void
  ): void;
}

export class SyncStatus extends TypedEventEmitter<StatusEvents> {
  private readonly receivedMessages: Set<MessageId>;
  private readonly missingMessages: Set<MessageId>;
  private readonly lostMessages: Set<MessageId>;
  private sendScheduled = false;
  private cleaned = false;

  public constructor() {
    super();

    this.receivedMessages = new Set();
    this.missingMessages = new Set();
    this.lostMessages = new Set();
  }

  /**
   * Cleanup all tracked message IDs. Should be called when stopping the channel.
   */
  public cleanUp(): void {
    // Mark as cleaned to prevent any pending microtasks from firing
    this.cleaned = true;
    this.receivedMessages.clear();
    this.missingMessages.clear();
    this.lostMessages.clear();
  }

  public onMessagesReceived(...messageIds: MessageId[]): void {
    for (const messageId of messageIds) {
      this.missingMessages.delete(messageId);
      this.lostMessages.delete(messageId);
      this.receivedMessages.add(messageId);
    }
    this.scheduleSend();
  }

  public onMessagesMissing(...messageIds: MessageId[]): void {
    for (const messageId of messageIds) {
      if (
        !this.receivedMessages.has(messageId) &&
        !this.lostMessages.has(messageId)
      ) {
        this.missingMessages.add(messageId);
      } else {
        log.error(
          "A message previously received or lost has been marked as missing",
          messageId
        );
      }
    }
    this.scheduleSend();
  }

  public onMessagesLost(...messageIds: MessageId[]): void {
    for (const messageId of messageIds) {
      this.missingMessages.delete(messageId);
      this.lostMessages.add(messageId);
    }
    this.scheduleSend();
  }

  /**
   * Schedule an event to be sent on the next microtask.
   * Multiple calls within the same task will result in only one event being sent.
   * This prevents event spam when processing batches of messages.
   */
  private scheduleSend(): void {
    if (!this.sendScheduled) {
      this.sendScheduled = true;
      queueMicrotask(() => {
        this.sendScheduled = false;
        this.safeSend();
      });
    }
  }

  private safeSend(): void {
    // Don't send events if cleanup was already called
    if (this.cleaned) {
      return;
    }

    const statusEvent =
      this.missingMessages.size === 0
        ? StatusEvent.Synced
        : StatusEvent.Syncing;
    try {
      this.dispatchEvent(
        new CustomEvent(statusEvent, {
          detail: {
            received: this.receivedMessages.size,
            missing: this.missingMessages.size,
            lost: this.lostMessages.size
          }
        })
      );
    } catch (error) {
      log.error(`Failed to dispatch sync status:`, error);
    }
  }
}
