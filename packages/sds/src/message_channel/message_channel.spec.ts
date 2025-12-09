import { utf8ToBytes } from "@waku/utils/bytes";
import { expect } from "chai";

import { DefaultBloomFilter } from "../bloom_filter/bloom.js";

import { MessageChannelEvent } from "./events.js";
import {
  ContentMessage,
  HistoryEntry,
  Message,
  MessageId,
  SyncMessage
} from "./message.js";
import {
  DEFAULT_BLOOM_FILTER_OPTIONS,
  ILocalHistory,
  MessageChannel
} from "./message_channel.js";

const channelId = "test-channel";
const callback = (_message: Message): Promise<{ success: boolean }> => {
  return Promise.resolve({ success: true });
};

const getBloomFilter = (channel: MessageChannel): DefaultBloomFilter => {
  return channel["filter"] as DefaultBloomFilter;
};

const messagesA = ["message-1", "message-2"];
const messagesB = [
  "message-3",
  "message-4",
  "message-5",
  "message-6",
  "message-7"
];

const sendMessage = async (
  channel: MessageChannel,
  payload: Uint8Array,
  callback: (message: ContentMessage) => Promise<{ success: boolean }>
): Promise<void> => {
  channel.pushOutgoingMessage(payload, callback);
  await channel.processTasks();
};

const sendSyncMessage = async (
  channel: MessageChannel,
  callback: (message: SyncMessage) => Promise<boolean>
): Promise<void> => {
  await channel.pushOutgoingSyncMessage(callback);
  await channel.processTasks();
};

const receiveMessage = async (
  channel: MessageChannel,
  message: Message,
  retrievalHint?: Uint8Array
): Promise<void> => {
  channel.pushIncomingMessage(message, retrievalHint);
  await channel.processTasks();
};

describe("MessageChannel", function () {
  this.timeout(5000);
  let channelA: MessageChannel;
  let channelB: MessageChannel;

  describe("sending a message ", () => {
    beforeEach(() => {
      channelA = new MessageChannel(channelId, "alice");
    });

    it("should increase lamport timestamp", async () => {
      const timestampBefore = channelA["lamportTimestamp"];
      await sendMessage(channelA, utf8ToBytes("message"), callback);
      const timestampAfter = channelA["lamportTimestamp"];
      expect(timestampAfter).to.equal(timestampBefore + 1n);
    });

    it("should push the message to the outgoing buffer", async () => {
      const bufferLengthBefore = channelA["outgoingBuffer"].length;
      await sendMessage(channelA, utf8ToBytes("message"), callback);
      const bufferLengthAfter = channelA["outgoingBuffer"].length;
      expect(bufferLengthAfter).to.equal(bufferLengthBefore + 1);
    });

    it("should insert message into bloom filter", async () => {
      const payload = utf8ToBytes("message");
      const messageId = MessageChannel.getMessageId(payload);
      await sendMessage(channelA, payload, callback);
      const bloomFilter = getBloomFilter(channelA);
      expect(bloomFilter.lookup(messageId)).to.equal(true);
    });

    it("should insert message id into causal history", async () => {
      const payload = utf8ToBytes("message");
      const expectedTimestamp = channelA["lamportTimestamp"] + 1n;
      const messageId = MessageChannel.getMessageId(payload);
      await sendMessage(channelA, payload, callback);
      const messageIdLog = channelA["localHistory"] as ILocalHistory;
      expect(messageIdLog.length).to.equal(1);
      expect(
        messageIdLog.some(
          (log) =>
            log.lamportTimestamp === expectedTimestamp &&
            log.messageId === messageId
        )
      ).to.equal(true);
    });

    it("should add sent message to localHistory with retrievalHint", async () => {
      const payload = utf8ToBytes("message with retrieval hint");
      const messageId = MessageChannel.getMessageId(payload);
      const testRetrievalHint = utf8ToBytes("test-retrieval-hint-data");

      await sendMessage(channelA, payload, async (_message) => {
        // Simulate successful sending with retrievalHint
        return { success: true, retrievalHint: testRetrievalHint };
      });

      const localHistory = channelA["localHistory"] as ILocalHistory;
      expect(localHistory.length).to.equal(1);

      // Find the message in local history
      const historyEntry = localHistory.find(
        (entry) => entry.messageId === messageId
      );
      expect(historyEntry).to.exist;
      expect(historyEntry!.retrievalHint).to.deep.equal(testRetrievalHint);
    });

    it("should attach causal history and bloom filter to each message", async () => {
      const bloomFilter = new DefaultBloomFilter(DEFAULT_BLOOM_FILTER_OPTIONS);
      const causalHistorySize = channelA["causalHistorySize"];
      const filterBytes = new Array<Uint8Array>();
      const messages = new Array<string>(causalHistorySize + 5)
        .fill("message")
        .map((message, index) => `${message}-${index}`);

      for (const message of messages) {
        filterBytes.push(bloomFilter.toBytes());
        await sendMessage(channelA, utf8ToBytes(message), callback);
        bloomFilter.insert(MessageChannel.getMessageId(utf8ToBytes(message)));
      }

      const outgoingBuffer = channelA["outgoingBuffer"] as Message[];
      expect(outgoingBuffer.length).to.equal(messages.length);

      outgoingBuffer.forEach((message, index) => {
        expect(message.content).to.deep.equal(utf8ToBytes(messages[index]));
        // Correct bloom filter should be attached to each message
        expect(message.bloomFilter).to.deep.equal(filterBytes[index]);
      });

      // Causal history should only contain the last N messages as defined by causalHistorySize
      const causalHistory =
        outgoingBuffer[outgoingBuffer.length - 1].causalHistory;
      expect(causalHistory.length).to.equal(causalHistorySize);

      const expectedCausalHistory = messages
        .slice(-causalHistorySize - 1, -1)
        .map((message) => ({
          messageId: MessageChannel.getMessageId(utf8ToBytes(message)),
          retrievalHint: undefined,
          senderId: "alice"
        }));
      expect(causalHistory).to.deep.equal(expectedCausalHistory);
    });
  });

  describe("receiving a message", () => {
    beforeEach(() => {
      channelA = new MessageChannel(channelId, "alice");
      channelB = new MessageChannel(channelId, "bob");
    });

    it("should increase lamport timestamp", async () => {
      const timestampBefore = channelA["lamportTimestamp"];
      await sendMessage(channelB, utf8ToBytes("message"), async (message) => {
        await receiveMessage(channelA, message);
        return { success: true };
      });
      const timestampAfter = channelA["lamportTimestamp"];
      expect(timestampAfter).to.equal(timestampBefore + 1n);
    });

    // TODO: test is failing in CI, investigate in https://github.com/logos-messaging/logos-messaging-js/issues/2648
    it.skip("should update lamport timestamp if greater than current timestamp and dependencies are met", async () => {
      const testChannelA = new MessageChannel(channelId, "alice");
      const testChannelB = new MessageChannel(channelId, "bob");

      const timestampBefore = testChannelA["lamportTimestamp"];

      for (const m of messagesA) {
        await sendMessage(testChannelA, utf8ToBytes(m), callback);
      }
      for (const m of messagesB) {
        await sendMessage(testChannelB, utf8ToBytes(m), async (message) => {
          await receiveMessage(testChannelA, message);
          return { success: true };
        });
      }
      const timestampAfter = testChannelA["lamportTimestamp"];
      expect(timestampAfter - timestampBefore).to.equal(
        BigInt(messagesB.length)
      );
    });

    // TODO: test is failing in CI, investigate in https://github.com/logos-messaging/logos-messaging-js/issues/2648
    it.skip("should maintain proper timestamps if all messages received", async () => {
      const aTimestampBefore = channelA["lamportTimestamp"];
      let timestamp = channelB["lamportTimestamp"];
      for (const m of messagesA) {
        await sendMessage(channelA, utf8ToBytes(m), async (message) => {
          timestamp++;
          await receiveMessage(channelB, message);
          expect(channelB["lamportTimestamp"]).to.equal(timestamp);
          return { success: true };
        });
      }

      for (const m of messagesB) {
        await sendMessage(channelB, utf8ToBytes(m), async (message) => {
          timestamp++;
          await receiveMessage(channelA, message);
          expect(channelA["lamportTimestamp"]).to.equal(timestamp);
          return { success: true };
        });
      }

      const expectedLength = messagesA.length + messagesB.length;
      expect(channelA["lamportTimestamp"]).to.equal(
        aTimestampBefore + BigInt(expectedLength)
      );
      expect(channelA["lamportTimestamp"]).to.equal(
        channelB["lamportTimestamp"]
      );
    });

    it("should add received messages to bloom filter", async () => {
      for (const m of messagesA) {
        await sendMessage(channelA, utf8ToBytes(m), async (message) => {
          await receiveMessage(channelB, message);
          const bloomFilter = getBloomFilter(channelB);
          expect(bloomFilter.lookup(message.messageId)).to.equal(true);
          return { success: true };
        });
      }
    });

    it("should add to incoming buffer if dependencies are not met", async () => {
      for (const m of messagesA) {
        await sendMessage(channelA, utf8ToBytes(m), callback);
      }

      let receivedMessage: Message | null = null;
      const timestampBefore = channelB["lamportTimestamp"];

      await sendMessage(
        channelA,
        utf8ToBytes(messagesB[0]),
        async (message) => {
          receivedMessage = message;
          await receiveMessage(channelB, message);
          return { success: true };
        }
      );

      const incomingBuffer = channelB["incomingBuffer"];
      expect(incomingBuffer.length).to.equal(1);
      expect(incomingBuffer[0].messageId).to.equal(receivedMessage!.messageId);

      // Since the dependency is not met, the lamport timestamp should not increase
      const timestampAfter = channelB["lamportTimestamp"];
      expect(timestampAfter).to.equal(timestampBefore);

      // Message should not be in local history
      const localHistory = channelB["localHistory"];
      expect(
        localHistory.some(
          ({ messageId }) => messageId === receivedMessage!.messageId
        )
      ).to.equal(false);
    });

    it("should add received message to localHistory with retrievalHint", async () => {
      const payload = utf8ToBytes("message with retrieval hint");
      const messageId = MessageChannel.getMessageId(payload);
      const testRetrievalHint = utf8ToBytes("test-retrieval-hint-data");

      await receiveMessage(
        channelA,
        new Message(
          messageId,
          channelA.channelId,
          "not-alice",
          [],
          1n,
          undefined,
          payload,
          undefined,
          testRetrievalHint
        ),
        testRetrievalHint
      );

      const localHistory = channelA["localHistory"] as ILocalHistory;
      expect(localHistory.length).to.equal(1);

      // Find the message in local history
      const historyEntry = localHistory.find(
        (entry) => entry.messageId === messageId
      );
      expect(historyEntry).to.exist;
      expect(historyEntry!.retrievalHint).to.deep.equal(testRetrievalHint);
    });

    it("should maintain chronological order of messages in localHistory", async () => {
      // Send messages with different timestamps (including own messages)
      const message1Payload = utf8ToBytes("message 1");
      const message2Payload = utf8ToBytes("message 2");
      const message3Payload = utf8ToBytes("message 3");

      const message1Id = MessageChannel.getMessageId(message1Payload);
      const message2Id = MessageChannel.getMessageId(message2Payload);
      const message3Id = MessageChannel.getMessageId(message3Payload);

      const startTimestamp = channelA["lamportTimestamp"];

      // Send own message first (timestamp will be 1)
      await sendMessage(channelA, message1Payload, callback);

      // Receive a message from another sender with higher timestamp (3)
      await receiveMessage(
        channelA,
        new ContentMessage(
          message3Id,
          channelA.channelId,
          "bob",
          [],
          startTimestamp + 3n, // Higher timestamp
          undefined,
          message3Payload
        )
      );

      // Receive a message from another sender with middle timestamp (2)
      await receiveMessage(
        channelA,
        new ContentMessage(
          message2Id,
          channelA.channelId,
          "carol",
          [],
          startTimestamp + 2n, // Middle timestamp
          undefined,
          message2Payload
        )
      );

      const localHistory = channelA["localHistory"];
      expect(localHistory.length).to.equal(3);

      // Verify chronological order: message1 (ts=1), message2 (ts=2), message3 (ts=3)

      const first = localHistory.findIndex(
        ({ messageId, lamportTimestamp }) => {
          return (
            messageId === message1Id && lamportTimestamp === startTimestamp + 1n
          );
        }
      );
      expect(first).to.eq(0);

      const second = localHistory.findIndex(
        ({ messageId, lamportTimestamp }) => {
          return (
            messageId === message2Id && lamportTimestamp === startTimestamp + 2n
          );
        }
      );
      expect(second).to.eq(1);

      const third = localHistory.findIndex(
        ({ messageId, lamportTimestamp }) => {
          return (
            messageId === message3Id && lamportTimestamp === startTimestamp + 3n
          );
        }
      );
      expect(third).to.eq(2);
    });

    it("should handle messages with same timestamp ordered by messageId", async () => {
      const message1Payload = utf8ToBytes("message a");
      const message2Payload = utf8ToBytes("message b");

      const message1Id = MessageChannel.getMessageId(message1Payload);
      const message2Id = MessageChannel.getMessageId(message2Payload);

      // Receive messages with same timestamp but different message IDs
      // The valueOf() method ensures ordering by messageId when timestamps are equal
      await receiveMessage(
        channelA,
        new ContentMessage(
          message2Id, // This will come second alphabetically by messageId
          channelA.channelId,
          "bob",
          [],
          5n, // Same timestamp
          undefined,
          message2Payload
        )
      );

      await receiveMessage(
        channelA,
        new ContentMessage(
          message1Id, // This will come first alphabetically by messageId
          channelA.channelId,
          "carol",
          [],
          5n, // Same timestamp
          undefined,
          message1Payload
        )
      );

      const localHistory = channelA["localHistory"] as ILocalHistory;
      expect(localHistory.length).to.equal(2);

      // When timestamps are equal, should be ordered by messageId lexicographically
      // The valueOf() method creates "000000000000005_messageId" for comparison
      const expectedOrder = [message1Id, message2Id].sort();

      const first = localHistory.findIndex(
        ({ messageId, lamportTimestamp }) => {
          return messageId === expectedOrder[0] && lamportTimestamp == 5n;
        }
      );
      expect(first).to.eq(0);

      const second = localHistory.findIndex(
        ({ messageId, lamportTimestamp }) => {
          return messageId === expectedOrder[1] && lamportTimestamp == 5n;
        }
      );
      expect(second).to.eq(1);
    });
  });

  describe("reviewing ack status", () => {
    beforeEach(() => {
      channelA = new MessageChannel(channelId, "alice", {
        causalHistorySize: 2
      });
      channelB = new MessageChannel(channelId, "bob", { causalHistorySize: 2 });
    });

    it("should mark all messages in causal history as acknowledged", async () => {
      for (const m of messagesA) {
        await sendMessage(channelA, utf8ToBytes(m), async (message) => {
          await receiveMessage(channelB, message);
          return { success: true };
        });
      }
      await channelA.processTasks();
      await channelB.processTasks();

      await sendMessage(
        channelA,
        utf8ToBytes("not-in-history"),
        async (message) => {
          await receiveMessage(channelB, message);
          return { success: true };
        }
      );
      await channelA.processTasks();
      await channelB.processTasks();

      expect(channelA["outgoingBuffer"].length).to.equal(messagesA.length + 1);

      await sendMessage(
        channelB,
        utf8ToBytes(messagesB[0]),
        async (message) => {
          await receiveMessage(channelA, message);
          return { success: true };
        }
      );
      await channelA.processTasks();
      await channelB.processTasks();

      // Channel B only includes the last causalHistorySize messages in its causal history
      // Since B received message-1, message-2, and not-in-history (3 messages),
      // and causalHistorySize is 3, it will only include the last 2 in its causal history
      // So message-1 won't be acknowledged, only message-2 and not-in-history
      const outgoingBuffer = channelA["outgoingBuffer"] as Message[];
      expect(outgoingBuffer.length).to.equal(1);
      // The remaining message should be message-1 (not acknowledged)
      expect(outgoingBuffer[0].messageId).to.equal(
        MessageChannel.getMessageId(utf8ToBytes(messagesA[0]))
      );
    });

    it("should not mark messages in causal history as acknowledged if it's our own message", async () => {
      for (const m of messagesA) {
        await sendMessage(channelA, utf8ToBytes(m), async (message) => {
          await receiveMessage(channelA, message); // same channel used on purpose
          return { success: true };
        });
      }
      await channelA.processTasks();

      // All messages remain in the buffer
      expect(channelA["outgoingBuffer"].length).to.equal(messagesA.length);
    });

    it("should track probabilistic acknowledgements of messages received in bloom filter", async () => {
      const possibleAcksThreshold = channelA["possibleAcksThreshold"];
      const causalHistorySize = channelA["causalHistorySize"];

      const unacknowledgedMessages = [
        "unacknowledged-message-1",
        "unacknowledged-message-2"
      ];
      const messages = [...messagesA, ...messagesB.slice(0, -1)];
      // Send messages to be received by channel B
      for (const m of messages) {
        await sendMessage(channelA, utf8ToBytes(m), async (message) => {
          await receiveMessage(channelB, message);
          return { success: true };
        });
      }

      // Send messages not received by channel B
      for (const m of unacknowledgedMessages) {
        await sendMessage(channelA, utf8ToBytes(m), callback);
      }

      // Channel B sends a message to channel A
      await sendMessage(
        channelB,
        utf8ToBytes(messagesB[messagesB.length - 1]),
        async (message) => {
          await receiveMessage(channelA, message);
          return { success: true };
        }
      );

      const possibleAcks: ReadonlyMap<MessageId, number> =
        channelA["possibleAcks"];
      // Other than the message IDs which were included in causal history,
      // the remaining messages sent by channel A should be considered possibly acknowledged
      // for having been included in the bloom filter sent from channel B
      const expectedAcknowledgementsSize = messages.length - causalHistorySize;
      if (expectedAcknowledgementsSize <= 0) {
        throw new Error("expectedAcknowledgementsSize must be greater than 0");
      }
      expect(possibleAcks.size).to.equal(expectedAcknowledgementsSize);
      // Channel B only included the last N messages in causal history
      messages.slice(0, -causalHistorySize).forEach((m) => {
        expect(
          possibleAcks.get(MessageChannel.getMessageId(utf8ToBytes(m)))
        ).to.equal(1);
      });

      // Messages that never reached channel B should not be acknowledged
      unacknowledgedMessages.forEach((m) => {
        expect(
          possibleAcks.has(MessageChannel.getMessageId(utf8ToBytes(m)))
        ).to.equal(false);
      });

      // When channel C sends more messages, it will include all the same messages
      // in the bloom filter as before, which should mark them as fully acknowledged in channel A
      for (let i = 1; i < possibleAcksThreshold; i++) {
        // Send messages until acknowledgement count is reached
        await sendMessage(channelB, utf8ToBytes(`x-${i}`), async (message) => {
          await receiveMessage(channelA, message);
          return { success: true };
        });
      }

      // No more possible acknowledgements should be in channel A
      expect(possibleAcks.size).to.equal(0);

      // Messages that were not acknowledged should still be in the outgoing buffer
      expect(channelA["outgoingBuffer"].length).to.equal(
        unacknowledgedMessages.length
      );
      unacknowledgedMessages.forEach((m) => {
        expect(
          (channelA["outgoingBuffer"] as Message[]).some(
            (message) =>
              message.messageId === MessageChannel.getMessageId(utf8ToBytes(m))
          )
        ).to.equal(true);
      });
    });

    it("should not track probabilistic acknowledgements of messages received in bloom filter of own messages", async () => {
      for (const m of messagesA) {
        await sendMessage(channelA, utf8ToBytes(m), async (message) => {
          await receiveMessage(channelA, message);
          return { success: true };
        });
      }

      const possibleAcks: ReadonlyMap<MessageId, number> =
        channelA["possibleAcks"];
      expect(possibleAcks.size).to.equal(0);
    });

    it("First message is missed, then re-sent, should be ack'd", async () => {
      const firstMessage = utf8ToBytes("first message");
      const firstMessageId = MessageChannel.getMessageId(firstMessage);
      let messageAcked = false;
      channelA.addEventListener(
        MessageChannelEvent.OutMessageAcknowledged,
        (event) => {
          if (firstMessageId === event.detail) {
            messageAcked = true;
          }
        }
      );

      await sendMessage(channelA, firstMessage, callback);

      const secondMessage = utf8ToBytes("second message");
      await sendMessage(channelA, secondMessage, async (message) => {
        await receiveMessage(channelB, message);
        return { success: true };
      });

      const thirdMessage = utf8ToBytes("third message");
      await sendMessage(channelB, thirdMessage, async (message) => {
        await receiveMessage(channelA, message);
        return { success: true };
      });

      expect(messageAcked).to.be.false;

      // Now, A resends first message, and B is receiving it.
      await sendMessage(channelA, firstMessage, async (message) => {
        await receiveMessage(channelB, message);
        return { success: true };
      });

      // And be sends a sync message
      const res = await channelB.pushOutgoingSyncMessage(async (message) => {
        await receiveMessage(channelA, message);
        return true;
      });

      expect(res).to.be.true;
      expect(messageAcked).to.be.true;
    });
  });

  describe("Sweeping incoming buffer", () => {
    beforeEach(() => {
      channelA = new MessageChannel(channelId, "alice", {
        causalHistorySize: 2
      });
      channelB = new MessageChannel(channelId, "bob", { causalHistorySize: 2 });
    });

    it("should detect messages with missing dependencies", async () => {
      const causalHistorySize = channelA["causalHistorySize"];
      for (const m of messagesA) {
        await sendMessage(channelA, utf8ToBytes(m), callback);
      }

      await sendMessage(
        channelA,
        utf8ToBytes(messagesB[0]),
        async (message) => {
          await receiveMessage(channelB, message);
          return { success: true };
        }
      );

      const incomingBuffer = channelB["incomingBuffer"];
      expect(incomingBuffer.length).to.equal(1);
      expect(incomingBuffer[0].messageId).to.equal(
        MessageChannel.getMessageId(utf8ToBytes(messagesB[0]))
      );

      const missingMessages = channelB.sweepIncomingBuffer();
      expect(missingMessages.length).to.equal(causalHistorySize);
      expect(missingMessages[0].messageId).to.equal(
        MessageChannel.getMessageId(utf8ToBytes(messagesA[0]))
      );
    });

    it("should deliver messages after dependencies are met", async () => {
      const causalHistorySize = channelA["causalHistorySize"];
      const sentMessages = new Array<Message>();
      // First, send messages from A but DON'T deliver them to B yet
      for (const m of messagesA) {
        await sendMessage(channelA, utf8ToBytes(m), async (message) => {
          sentMessages.push(message);
          // Don't receive them at B yet - we want them to be missing dependencies
          return { success: true };
        });
      }
      await channelA.processTasks();

      // Now send a message from A to B that depends on messagesA
      await sendMessage(
        channelA,
        utf8ToBytes(messagesB[0]),
        async (message) => {
          await receiveMessage(channelB, message);
          return { success: true };
        }
      );
      await channelA.processTasks();
      await channelB.processTasks();

      // Message should be in incoming buffer waiting for dependencies
      const missingMessages = channelB.sweepIncomingBuffer();
      expect(missingMessages.length).to.equal(causalHistorySize);
      expect(missingMessages[0].messageId).to.equal(
        MessageChannel.getMessageId(utf8ToBytes(messagesA[0]))
      );

      let incomingBuffer = channelB["incomingBuffer"];
      expect(incomingBuffer.length).to.equal(1);

      // Now deliver the missing dependencies
      for (const m of sentMessages) {
        await receiveMessage(channelB, m);
      }
      await channelB.processTasks();

      // Sweep should now deliver the waiting message
      const missingMessages2 = channelB.sweepIncomingBuffer();
      expect(missingMessages2.length).to.equal(0);

      incomingBuffer = channelB["incomingBuffer"];
      expect(incomingBuffer.length).to.equal(0);
    });

    it("should mark a message as irretrievably lost if timeout is exceeded", async () => {
      // Create a channel with very very short timeout
      const channelC: MessageChannel = new MessageChannel(channelId, "carol", {
        timeoutForLostMessagesMs: 10
      });

      for (const m of messagesA) {
        await sendMessage(channelA, utf8ToBytes(m), callback);
      }

      let irretrievablyLost = false;
      const messageToBeLostId = MessageChannel.getMessageId(
        utf8ToBytes(messagesA[0])
      );
      channelC.addEventListener(MessageChannelEvent.InMessageLost, (event) => {
        for (const hist of event.detail) {
          if (hist.messageId === messageToBeLostId) {
            irretrievablyLost = true;
          }
        }
      });

      await sendMessage(
        channelA,
        utf8ToBytes(messagesB[0]),
        async (message) => {
          await receiveMessage(channelC, message);
          return { success: true };
        }
      );

      channelC.sweepIncomingBuffer();

      await new Promise((resolve) => setTimeout(resolve, 20));

      channelC.sweepIncomingBuffer();

      expect(irretrievablyLost).to.be.true;
    });

    it("should emit InMessageLost event with retrievalHint when timeout is exceeded", async () => {
      const testRetrievalHint = utf8ToBytes("lost-message-hint");
      let lostMessages: HistoryEntry[] = [];

      // Create a channel with very short timeout
      const channelC: MessageChannel = new MessageChannel(channelId, "carol", {
        timeoutForLostMessagesMs: 10
      });

      channelC.addEventListener(MessageChannelEvent.InMessageLost, (event) => {
        lostMessages = event.detail;
      });

      // Send message from A with retrievalHint
      await sendMessage(
        channelA,
        utf8ToBytes(messagesA[0]),
        async (message) => {
          message.retrievalHint = testRetrievalHint;
          return { success: true, retrievalHint: testRetrievalHint };
        }
      );

      // Send another message from A
      await sendMessage(channelA, utf8ToBytes(messagesA[1]), callback);

      // Send a message to C that depends on the previous messages
      await sendMessage(
        channelA,
        utf8ToBytes(messagesB[0]),
        async (message) => {
          await receiveMessage(channelC, message);
          return { success: true };
        }
      );

      // First sweep - should detect missing messages
      channelC.sweepIncomingBuffer();

      // Wait for timeout
      await new Promise((resolve) => setTimeout(resolve, 20));

      // Second sweep - should mark messages as lost
      channelC.sweepIncomingBuffer();

      expect(lostMessages.length).to.equal(2);

      // Verify retrievalHint is included in the lost message
      const lostMessageWithHint = lostMessages.find(
        (m) =>
          m.messageId === MessageChannel.getMessageId(utf8ToBytes(messagesA[0]))
      );
      expect(lostMessageWithHint).to.exist;
      expect(lostMessageWithHint!.retrievalHint).to.deep.equal(
        testRetrievalHint
      );

      // Verify message without retrievalHint has undefined
      const lostMessageWithoutHint = lostMessages.find(
        (m) =>
          m.messageId === MessageChannel.getMessageId(utf8ToBytes(messagesA[1]))
      );
      expect(lostMessageWithoutHint).to.exist;
      expect(lostMessageWithoutHint!.retrievalHint).to.be.undefined;
    });

    it("should remove messages without delivering if timeout is exceeded", async () => {
      const causalHistorySize = channelA["causalHistorySize"];
      // Create a channel with very very short timeout
      const channelC: MessageChannel = new MessageChannel(channelId, "carol", {
        timeoutForLostMessagesMs: 10
      });

      for (const m of messagesA) {
        await sendMessage(channelA, utf8ToBytes(m), callback);
      }

      await sendMessage(
        channelA,
        utf8ToBytes(messagesB[0]),
        async (message) => {
          await receiveMessage(channelC, message);
          return { success: true };
        }
      );

      const missingMessages = channelC.sweepIncomingBuffer();
      expect(missingMessages.length).to.equal(causalHistorySize);
      let incomingBuffer = channelC["incomingBuffer"];
      expect(incomingBuffer.length).to.equal(1);

      await new Promise((resolve) => setTimeout(resolve, 20));

      channelC.sweepIncomingBuffer();
      incomingBuffer = channelC["incomingBuffer"];
      expect(incomingBuffer.length).to.equal(0);
    });

    it("should return HistoryEntry with retrievalHint from sweepIncomingBuffer", async () => {
      const testRetrievalHint = utf8ToBytes("test-retrieval-hint");

      // Send message from A with a retrievalHint
      await sendMessage(
        channelA,
        utf8ToBytes(messagesA[0]),
        async (message) => {
          message.retrievalHint = testRetrievalHint;
          return { success: true, retrievalHint: testRetrievalHint };
        }
      );

      // Send another message from A that depends on the first one
      await sendMessage(
        channelA,
        utf8ToBytes(messagesA[1]),
        async (_message) => {
          // Don't send to B yet - we want B to have missing dependencies
          return { success: true };
        }
      );

      // Send a message from A to B that depends on previous messages
      await sendMessage(
        channelA,
        utf8ToBytes(messagesB[0]),
        async (message) => {
          await receiveMessage(channelB, message);
          return { success: true };
        }
      );

      // Sweep should detect missing dependencies and return them with retrievalHint
      const missingMessages = channelB.sweepIncomingBuffer();
      expect(missingMessages.length).to.equal(2);

      // Find the first message in missing dependencies
      const firstMissingMessage = missingMessages.find(
        (m) =>
          m.messageId === MessageChannel.getMessageId(utf8ToBytes(messagesA[0]))
      );
      expect(firstMissingMessage).to.exist;
      expect(firstMissingMessage!.retrievalHint).to.deep.equal(
        testRetrievalHint
      );
    });

    it("should emit InMessageMissing event with retrievalHint", async () => {
      const testRetrievalHint1 = utf8ToBytes("hint-for-message-1");
      const testRetrievalHint2 = utf8ToBytes("hint-for-message-2");
      let eventReceived = false;
      let emittedMissingMessages: HistoryEntry[] = [];

      // Listen for InMessageMissing event
      channelB.addEventListener(
        MessageChannelEvent.InMessageMissing,
        (event) => {
          eventReceived = true;
          emittedMissingMessages = event.detail;
        }
      );

      // Send messages from A with retrievalHints
      await sendMessage(
        channelA,
        utf8ToBytes(messagesA[0]),
        async (message) => {
          message.retrievalHint = testRetrievalHint1;
          return { success: true, retrievalHint: testRetrievalHint1 };
        }
      );

      await sendMessage(
        channelA,
        utf8ToBytes(messagesA[1]),
        async (message) => {
          message.retrievalHint = testRetrievalHint2;
          return { success: true, retrievalHint: testRetrievalHint2 };
        }
      );

      // Send a message to B that depends on the previous messages
      await sendMessage(
        channelA,
        utf8ToBytes(messagesB[0]),
        async (message) => {
          await receiveMessage(channelB, message);
          return { success: true };
        }
      );

      // Sweep should trigger InMessageMissing event
      channelB.sweepIncomingBuffer();

      expect(eventReceived).to.be.true;
      expect(emittedMissingMessages.length).to.equal(2);

      // Verify retrievalHints are included in the event
      const firstMissing = emittedMissingMessages.find(
        (m) =>
          m.messageId === MessageChannel.getMessageId(utf8ToBytes(messagesA[0]))
      );
      const secondMissing = emittedMissingMessages.find(
        (m) =>
          m.messageId === MessageChannel.getMessageId(utf8ToBytes(messagesA[1]))
      );

      expect(firstMissing).to.exist;
      expect(firstMissing!.retrievalHint).to.deep.equal(testRetrievalHint1);
      expect(secondMissing).to.exist;
      expect(secondMissing!.retrievalHint).to.deep.equal(testRetrievalHint2);
    });

    it("should handle missing messages with undefined retrievalHint", async () => {
      let emittedMissingMessages: HistoryEntry[] = [];

      channelB.addEventListener(
        MessageChannelEvent.InMessageMissing,
        (event) => {
          emittedMissingMessages = event.detail;
        }
      );

      // Send message from A without retrievalHint
      await sendMessage(
        channelA,
        utf8ToBytes(messagesA[0]),
        async (_message) => {
          // Don't set retrievalHint
          return { success: true };
        }
      );

      // Send a message to B that depends on the previous message
      await sendMessage(
        channelA,
        utf8ToBytes(messagesB[0]),
        async (message) => {
          await receiveMessage(channelB, message);
          return { success: true };
        }
      );

      // Sweep should handle missing message with undefined retrievalHint
      const missingMessages = channelB.sweepIncomingBuffer();

      expect(missingMessages.length).to.equal(1);
      expect(missingMessages[0].messageId).to.equal(
        MessageChannel.getMessageId(utf8ToBytes(messagesA[0]))
      );
      expect(missingMessages[0].retrievalHint).to.be.undefined;

      // Event should also reflect undefined retrievalHint
      expect(emittedMissingMessages.length).to.equal(1);
      expect(emittedMissingMessages[0].retrievalHint).to.be.undefined;
    });
  });

  describe("Sweeping outgoing buffer", () => {
    beforeEach(() => {
      channelA = new MessageChannel(channelId, "alice", {
        causalHistorySize: 2
      });
      channelB = new MessageChannel(channelId, "bob", { causalHistorySize: 2 });
    });

    it("should partition messages based on acknowledgement status", async () => {
      for (const m of messagesA) {
        await sendMessage(channelA, utf8ToBytes(m), async (message) => {
          await receiveMessage(channelB, message);
          return { success: true };
        });
      }

      let { unacknowledged, possiblyAcknowledged } =
        channelA.sweepOutgoingBuffer();
      expect(unacknowledged.length).to.equal(messagesA.length);
      expect(possiblyAcknowledged.length).to.equal(0);

      // Make sure messages sent by channel A are not in causal history
      const causalHistorySize = channelA["causalHistorySize"];
      for (const m of messagesB.slice(0, causalHistorySize)) {
        await sendMessage(channelB, utf8ToBytes(m), callback);
      }

      await sendMessage(
        channelB,
        utf8ToBytes(messagesB[causalHistorySize]),
        async (message) => {
          await receiveMessage(channelA, message);
          return { success: true };
        }
      );

      // All messages that were previously unacknowledged should now be possibly acknowledged
      // since they were included in one of the bloom filters sent from channel B
      ({ unacknowledged, possiblyAcknowledged } =
        channelA.sweepOutgoingBuffer());
      expect(unacknowledged.length).to.equal(0);
      expect(possiblyAcknowledged.length).to.equal(messagesA.length);
    });
  });

  describe("Sync messages", () => {
    beforeEach(() => {
      channelA = new MessageChannel(channelId, "alice", {
        causalHistorySize: 2
      });
      channelB = new MessageChannel(channelId, "bob", { causalHistorySize: 2 });
      const message = utf8ToBytes("first message in channel");
      channelA["localHistory"].push(
        new ContentMessage(
          MessageChannel.getMessageId(message),
          "MyChannel",
          "alice",
          [],
          1n,
          undefined,
          message
        )
      );
    });

    it("should be sent with empty content", async () => {
      const res = await channelA.pushOutgoingSyncMessage(async (message) => {
        expect(message.content).to.be.undefined;
        return true;
      });
      expect(res).to.be.true;
    });

    it("should not be sent when there is no history", async () => {
      const channelC = new MessageChannel(channelId, "carol", {
        causalHistorySize: 2
      });
      const res = await channelC.pushOutgoingSyncMessage(async (_msg) => {
        throw "callback was called when it's not expected";
      });
      expect(res).to.be.false;
    });

    it("should not be added to outgoing buffer, bloom filter, or local log", async () => {
      const res = await channelA.pushOutgoingSyncMessage();
      expect(res).to.be.true;

      const outgoingBuffer = channelA["outgoingBuffer"] as Message[];
      expect(outgoingBuffer.length).to.equal(0);

      const bloomFilter = getBloomFilter(channelA);
      expect(
        bloomFilter.lookup(MessageChannel.getMessageId(new Uint8Array()))
      ).to.equal(false);

      const localLog = channelA["localHistory"];
      expect(localLog.length).to.equal(1); // beforeEach adds one message
    });

    it("should not be delivered", async () => {
      const timestampBefore = channelB["lamportTimestamp"];
      const res = await channelA.pushOutgoingSyncMessage(async (message) => {
        await receiveMessage(channelB, message);
        return true;
      });
      expect(res).to.be.true;
      const timestampAfter = channelB["lamportTimestamp"];
      expect(timestampAfter).to.equal(timestampBefore);

      const localLog = channelB["localHistory"];
      expect(localLog.length).to.equal(0);

      const bloomFilter = getBloomFilter(channelB);
      expect(
        bloomFilter.lookup(MessageChannel.getMessageId(new Uint8Array()))
      ).to.equal(false);
    });

    it("should update ack status of messages in outgoing buffer", async () => {
      const channelC = new MessageChannel(channelId, "carol", {
        causalHistorySize: 2
      });
      for (const m of messagesA) {
        await sendMessage(channelC, utf8ToBytes(m), async (message) => {
          await receiveMessage(channelB, message);
          return { success: true };
        });
      }

      await sendSyncMessage(channelB, async (message) => {
        await receiveMessage(channelC, message);
        return true;
      });

      const causalHistorySize = channelC["causalHistorySize"];
      const outgoingBuffer = channelC["outgoingBuffer"] as Message[];
      expect(outgoingBuffer.length).to.equal(
        messagesA.length - causalHistorySize
      );
    });
  });

  describe("Ephemeral messages", () => {
    beforeEach(() => {
      channelA = new MessageChannel(channelId, "alice");
    });

    it("should be sent without a timestamp, causal history, or bloom filter", async () => {
      const timestampBefore = channelA["lamportTimestamp"];
      await channelA.pushOutgoingEphemeralMessage(
        new Uint8Array(),
        async (message) => {
          expect(message.lamportTimestamp).to.equal(undefined);
          expect(message.causalHistory).to.deep.equal([]);
          expect(message.bloomFilter).to.equal(undefined);
          return true;
        }
      );

      const outgoingBuffer = channelA["outgoingBuffer"] as Message[];
      expect(outgoingBuffer.length).to.equal(0);

      const timestampAfter = channelA["lamportTimestamp"];
      expect(timestampAfter).to.equal(timestampBefore);
    });

    it("should be delivered immediately if received", async () => {
      const channelB = new MessageChannel(channelId, "bob");

      // Track initial state
      const localHistoryBefore = channelB["localHistory"].length;
      const incomingBufferBefore = channelB["incomingBuffer"].length;
      const timestampBefore = channelB["lamportTimestamp"];

      await channelA.pushOutgoingEphemeralMessage(
        utf8ToBytes(messagesA[0]),
        async (message) => {
          // Ephemeral messages should have no timestamp
          expect(message.lamportTimestamp).to.be.undefined;
          await receiveMessage(channelB, message);
          return true;
        }
      );
      await channelA.processTasks();
      await channelB.processTasks();

      // Verify ephemeral message behavior:
      // 1. Not added to local history
      expect(channelB["localHistory"].length).to.equal(localHistoryBefore);
      // 2. Not added to incoming buffer
      expect(channelB["incomingBuffer"].length).to.equal(incomingBufferBefore);
      // 3. Doesn't update lamport timestamp
      expect(channelB["lamportTimestamp"]).to.equal(timestampBefore);
    });
  });
});
