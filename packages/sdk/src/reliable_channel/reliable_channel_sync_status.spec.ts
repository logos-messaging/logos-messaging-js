import { createDecoder, createEncoder } from "@waku/core";
import {
  AutoSharding,
  IDecodedMessage,
  IDecoder,
  IEncoder
} from "@waku/interfaces";
import { createRoutingInfo, delay, MockWakuNode } from "@waku/utils";
import { utf8ToBytes } from "@waku/utils/bytes";
import { expect } from "chai";
import { beforeEach, describe } from "mocha";

import {
  createMockNodes,
  sendAndWaitForEvent,
  TEST_CONSTANTS,
  waitFor
} from "./test_utils.js";

import { ReliableChannel, StatusDetail } from "./index.js";

const TEST_CONTENT_TOPIC = "/my-tests/0/topic-name/proto";
const TEST_NETWORK_CONFIG: AutoSharding = {
  clusterId: 0,
  numShardsInCluster: 1
};
const TEST_ROUTING_INFO = createRoutingInfo(TEST_NETWORK_CONFIG, {
  contentTopic: TEST_CONTENT_TOPIC
});

describe("Sync Status", () => {
  let encoder: IEncoder;
  let decoder: IDecoder<IDecodedMessage>;
  let mockWakuNodeAlice: MockWakuNode;
  let mockWakuNodeBob: MockWakuNode;
  let reliableChannelAlice: ReliableChannel<any> | undefined;
  let reliableChannelBob: ReliableChannel<any> | undefined;

  beforeEach(async () => {
    encoder = createEncoder({
      contentTopic: TEST_CONTENT_TOPIC,
      routingInfo: TEST_ROUTING_INFO
    });
    decoder = createDecoder(TEST_CONTENT_TOPIC, TEST_ROUTING_INFO);

    const mockNodes = createMockNodes();
    mockWakuNodeAlice = mockNodes.alice;
    mockWakuNodeBob = mockNodes.bob;
  });

  afterEach(async () => {
    if (reliableChannelAlice) {
      await reliableChannelAlice.stop();
      reliableChannelAlice = undefined;
    }
    if (reliableChannelBob) {
      await reliableChannelBob.stop();
      reliableChannelBob = undefined;
    }
  });

  it("Synced status is emitted when a message is received", async () => {
    reliableChannelAlice = await ReliableChannel.create(
      mockWakuNodeAlice,
      "MyChannel",
      "alice",
      encoder,
      decoder
    );
    reliableChannelBob = await ReliableChannel.create(
      mockWakuNodeBob,
      "MyChannel",
      "bob",
      encoder,
      decoder
    );

    let statusDetail: StatusDetail | undefined;
    reliableChannelBob.syncStatus.addEventListener("synced", (event) => {
      statusDetail = event.detail;
    });

    const message = utf8ToBytes("message in channel");

    reliableChannelAlice.send(message);
    await waitFor(() => statusDetail);

    expect(statusDetail!.received).to.eq(1);
  });

  it("Synced status is emitted when a missing message is received", async () => {
    reliableChannelAlice = await ReliableChannel.create(
      mockWakuNodeAlice,
      "MyChannel",
      "alice",
      encoder,
      decoder,
      {
        retryIntervalMs: TEST_CONSTANTS.RETRY_INTERVAL_MS
      }
    );

    // Send a message before Bob goes online so it's marked as missing
    await sendAndWaitForEvent(
      reliableChannelAlice,
      utf8ToBytes("missing message")
    );

    reliableChannelBob = await ReliableChannel.create(
      mockWakuNodeBob,
      "MyChannel",
      "bob",
      encoder,
      decoder
    );

    let syncingStatusDetail: StatusDetail | undefined;
    reliableChannelBob.syncStatus.addEventListener("syncing", (event) => {
      syncingStatusDetail = event.detail;
    });

    let syncedStatusDetail: StatusDetail | undefined;
    reliableChannelBob.syncStatus.addEventListener("synced", (event) => {
      syncedStatusDetail = event.detail;
    });

    await sendAndWaitForEvent(
      reliableChannelAlice,
      utf8ToBytes("second message with missing message as dep")
    );

    await waitFor(() => syncingStatusDetail);

    expect(syncingStatusDetail!.missing).to.eq(1);
    expect(syncingStatusDetail!.received).to.eq(1);

    await waitFor(() => syncedStatusDetail);

    expect(syncedStatusDetail!.missing).to.eq(0);
    expect(syncedStatusDetail!.received).to.eq(2);
  });

  it("Synced status is emitted when a missing message is marked as lost", async () => {
    reliableChannelAlice = await ReliableChannel.create(
      mockWakuNodeAlice,
      "MyChannel",
      "alice",
      encoder,
      decoder,
      {
        syncMinIntervalMs: 0,
        retryIntervalMs: 0 // Do not retry so we can lose the message
      }
    );

    // Send a message before Bob goes online so it's marked as missing
    await sendAndWaitForEvent(
      reliableChannelAlice,
      utf8ToBytes("missing message")
    );

    reliableChannelBob = await ReliableChannel.create(
      mockWakuNodeBob,
      "MyChannel",
      "bob",
      encoder,
      decoder,
      {
        retrieveFrequencyMs: 0,
        syncMinIntervalMs: 0,
        sweepInBufIntervalMs: 0, // we want to control this
        timeoutForLostMessagesMs: 200 // timeout within the test
      }
    );

    let syncingStatusDetail: StatusDetail | undefined;
    reliableChannelBob.syncStatus.addEventListener("syncing", (event) => {
      syncingStatusDetail = event.detail;
    });

    await sendAndWaitForEvent(
      reliableChannelAlice,
      utf8ToBytes("second message with missing message as dep")
    );

    await waitFor(() => syncingStatusDetail);

    expect(syncingStatusDetail!.missing).to.eq(1, "at first, one missing");
    expect(syncingStatusDetail!.received).to.eq(1, "at first, one received");
    expect(syncingStatusDetail!.lost).to.eq(0, "at first, no loss");

    let syncedStatusDetail: StatusDetail | undefined;
    reliableChannelBob.syncStatus.addEventListener("synced", (event) => {
      syncedStatusDetail = event.detail;
    });

    // await long enough so message will be marked as lost
    await delay(200);
    reliableChannelBob.messageChannel["sweepIncomingBuffer"]();

    await waitFor(() => syncedStatusDetail);

    expect(syncedStatusDetail!.missing).to.eq(0, "no more missing message");
    expect(syncedStatusDetail!.received).to.eq(1, "still one received message");
    expect(syncedStatusDetail!.lost).to.eq(1, "missing message is marked lost");
  });
});
