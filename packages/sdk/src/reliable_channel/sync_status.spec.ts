import { MessageId } from "@waku/sds";
import { delay } from "@waku/utils";
import { expect } from "chai";

import { StatusDetail, StatusEvents, SyncStatus } from "./sync_status.js";

async function testSyncStatus(
  syncStatus: SyncStatus,
  statusEvent: keyof StatusEvents,
  onMessageFn: (...msgIds: MessageId[]) => void,
  expectedStatusDetail: Partial<StatusDetail>,
  ...messageIds: MessageId[]
): Promise<void> {
  let statusDetail: StatusDetail;
  syncStatus.addEventListener(statusEvent, (event) => {
    statusDetail = event.detail;
  });

  onMessageFn.bind(syncStatus)(...messageIds);

  while (!statusDetail!) {
    await delay(10);
  }

  expect(statusDetail.received).to.eq(expectedStatusDetail.received ?? 0);
  expect(statusDetail.missing).to.eq(expectedStatusDetail.missing ?? 0);
  expect(statusDetail.lost).to.eq(expectedStatusDetail.lost ?? 0);
}

describe("Sync Status", () => {
  let syncStatus: SyncStatus;
  beforeEach(() => {
    syncStatus = new SyncStatus();
  });

  afterEach(() => {
    syncStatus.cleanUp();
  });

  it("Emits 'synced' when new message received", async () => {
    await testSyncStatus(
      syncStatus,
      "synced",
      syncStatus.onMessagesReceived,
      { received: 1 },
      "123"
    );
  });

  it("Emits 'syncing' when message flagged as missed", async () => {
    await testSyncStatus(
      syncStatus,
      "syncing",
      syncStatus.onMessagesMissing,
      { missing: 1 },
      "123"
    );
  });

  it("Emits 'synced' when message flagged as lost", async () => {
    await testSyncStatus(
      syncStatus,
      "synced",
      syncStatus.onMessagesLost,
      { lost: 1 },
      "123"
    );
  });

  it("Emits 'syncing' then 'synced' when message flagged as missing and then received", async () => {
    await testSyncStatus(
      syncStatus,
      "syncing",
      syncStatus.onMessagesMissing,
      { missing: 1 },
      "123"
    );

    await testSyncStatus(
      syncStatus,
      "synced",
      syncStatus.onMessagesReceived,
      { received: 1 },
      "123"
    );
  });

  it("Emits 'syncing' then 'synced' when message flagged as missing and then lost", async () => {
    await testSyncStatus(
      syncStatus,
      "syncing",
      syncStatus.onMessagesMissing,
      { missing: 1 },
      "123"
    );

    await testSyncStatus(
      syncStatus,
      "synced",
      syncStatus.onMessagesLost,
      { lost: 1 },
      "123"
    );
  });

  it("Emits 'synced' then 'synced' when message flagged as lost and then received", async () => {
    await testSyncStatus(
      syncStatus,
      "synced",
      syncStatus.onMessagesLost,
      { lost: 1 },
      "123"
    );

    await testSyncStatus(
      syncStatus,
      "synced",
      syncStatus.onMessagesReceived,
      { received: 1 },
      "123"
    );
  });

  it("Emits 'syncing' until all messages are received or lost", async () => {
    await testSyncStatus(
      syncStatus,
      "synced",
      syncStatus.onMessagesReceived,
      { received: 1 },
      "1"
    );

    await testSyncStatus(
      syncStatus,
      "syncing",
      syncStatus.onMessagesMissing,
      { received: 1, missing: 3 },
      "2",
      "3",
      "4"
    );

    await testSyncStatus(
      syncStatus,
      "syncing",
      syncStatus.onMessagesReceived,
      { received: 2, missing: 2 },
      "2"
    );

    await testSyncStatus(
      syncStatus,
      "syncing",
      syncStatus.onMessagesReceived,
      { received: 3, missing: 1 },
      "3"
    );

    await testSyncStatus(
      syncStatus,
      "synced",
      syncStatus.onMessagesLost,
      { received: 3, lost: 1 },
      "4"
    );
  });

  it("Debounces events when receiving batch of messages", async () => {
    let eventCount = 0;
    let statusDetail: StatusDetail | undefined;

    syncStatus.addEventListener("synced", (event) => {
      eventCount++;
      statusDetail = event.detail;
    });

    // Process 100 messages in the same task
    for (let i = 0; i < 100; i++) {
      syncStatus.onMessagesReceived(`msg-${i}`);
    }

    // Wait for microtask to complete
    await delay(10);

    // Should only emit 1 event despite 100 calls
    expect(eventCount).to.eq(1, "Should only emit one event for batch");
    expect(statusDetail!.received).to.eq(100, "Should track all 100 messages");
  });
});
