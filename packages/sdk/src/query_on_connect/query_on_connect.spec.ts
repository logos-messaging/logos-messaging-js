import { type PeerId, TypedEventEmitter } from "@libp2p/interface";
import {
  HealthStatus,
  type IDecodedMessage,
  type IDecoder,
  IWakuEventEmitter,
  QueryRequestParams,
  WakuEvent
} from "@waku/interfaces";
import { delay } from "@waku/utils";
import { utf8ToBytes } from "@waku/utils/bytes";
import { expect } from "chai";
import { afterEach } from "mocha";
import sinon from "sinon";

import {
  IPeerManagerEvents,
  PeerManagerEventNames
} from "../peer_manager/peer_manager.js";

import {
  calculateTimeRange,
  QueryOnConnect,
  QueryOnConnectEvent,
  QueryOnConnectOptions
} from "./query_on_connect.js";

describe("QueryOnConnect", () => {
  let queryOnConnect: QueryOnConnect<IDecodedMessage>;
  let mockDecoders: IDecoder<IDecodedMessage>[];
  let mockPeerManagerEventEmitter: TypedEventEmitter<IPeerManagerEvents>;
  let mockWakuEventEmitter: IWakuEventEmitter;
  let mockQueryGenerator: sinon.SinonStub;
  let mockPeerId: PeerId;
  let options: QueryOnConnectOptions;

  beforeEach(() => {
    // Mock decoders
    mockDecoders = [
      {
        contentTopic: "/test/1/content",
        fromWireToProtoObj: sinon.stub(),
        fromProtoObj: sinon.stub()
      } as any,
      {
        contentTopic: "/test/2/content",
        fromWireToProtoObj: sinon.stub(),
        fromProtoObj: sinon.stub()
      } as any
    ];

    // Mock peer manager event emitter
    mockPeerManagerEventEmitter = {
      addEventListener: sinon.stub(),
      removeEventListener: sinon.stub(),
      dispatchEvent: sinon.stub()
    } as any;

    // Mock waku event emitter
    mockWakuEventEmitter = {
      addEventListener: sinon.stub(),
      removeEventListener: sinon.stub(),
      dispatchEvent: sinon.stub()
    } as any;

    // Mock retrieve function
    mockQueryGenerator = sinon.stub().callsFake(() =>
      (async function* () {
        yield [
          Promise.resolve({
            version: 1,
            timestamp: new Date(),
            contentTopic: "/test/1/content",
            pubsubTopic: "/waku/2/default-waku/proto",
            payload: new Uint8Array([1, 2, 3]),
            rateLimitProof: undefined,
            ephemeral: false,
            meta: undefined,
            hashStr: "12345"
          } as IDecodedMessage)
        ];
      })()
    );

    mockPeerId = {
      toString: () => "QmTestPeerId"
    } as unknown as PeerId;

    // Mock options
    options = {
      forceQueryThresholdMs: 10000
    };
  });

  afterEach(() => {
    sinon.restore();
  });

  describe("constructor", () => {
    it("should create QueryOnConnect instance with all required parameters", () => {
      queryOnConnect = new QueryOnConnect(
        mockDecoders,
        () => false,
        mockPeerManagerEventEmitter,
        mockWakuEventEmitter,
        mockQueryGenerator,
        options
      );

      expect(queryOnConnect).to.be.instanceOf(QueryOnConnect);
      expect(queryOnConnect.decoders).to.equal(mockDecoders);
    });

    it("should create QueryOnConnect instance without options", () => {
      queryOnConnect = new QueryOnConnect(
        mockDecoders,
        () => false,
        mockPeerManagerEventEmitter,
        mockWakuEventEmitter,
        mockQueryGenerator
      );

      expect(queryOnConnect).to.be.instanceOf(QueryOnConnect);
      expect(queryOnConnect.decoders).to.equal(mockDecoders);
    });

    it("should accept empty decoders array", () => {
      queryOnConnect = new QueryOnConnect(
        [],
        () => false,
        mockPeerManagerEventEmitter,
        mockWakuEventEmitter,
        mockQueryGenerator,
        options
      );

      expect(queryOnConnect.decoders).to.deep.equal([]);
    });
  });

  describe("start and stop", () => {
    beforeEach(() => {
      queryOnConnect = new QueryOnConnect(
        mockDecoders,
        () => false,
        mockPeerManagerEventEmitter,
        mockWakuEventEmitter,
        mockQueryGenerator,
        options
      );
    });

    it("should set up event listeners when started", () => {
      const peerEventSpy =
        mockPeerManagerEventEmitter.addEventListener as sinon.SinonSpy;
      const wakuEventSpy =
        mockWakuEventEmitter.addEventListener as sinon.SinonSpy;

      queryOnConnect.start();

      expect(peerEventSpy.calledWith(PeerManagerEventNames.StoreConnect)).to.be
        .true;
      expect(wakuEventSpy.calledWith(WakuEvent.Health)).to.be.true;
    });

    it("should remove event listeners when stopped", async () => {
      const peerRemoveSpy =
        mockPeerManagerEventEmitter.removeEventListener as sinon.SinonSpy;
      const wakuRemoveSpy =
        mockWakuEventEmitter.removeEventListener as sinon.SinonSpy;

      queryOnConnect.start();
      await queryOnConnect.stop();

      expect(peerRemoveSpy.calledWith(PeerManagerEventNames.StoreConnect)).to.be
        .true;
      expect(wakuRemoveSpy.calledWith(WakuEvent.Health)).to.be.true;
    });
  });

  describe("mock validation", () => {
    beforeEach(() => {
      queryOnConnect = new QueryOnConnect(
        mockDecoders,
        () => false,
        mockPeerManagerEventEmitter,
        mockWakuEventEmitter,
        mockQueryGenerator,
        options
      );
    });

    it("should work with stubbed peer manager event emitter", () => {
      expect(mockPeerManagerEventEmitter.addEventListener).to.be.a("function");
      expect(mockPeerManagerEventEmitter.removeEventListener).to.be.a(
        "function"
      );
      expect(mockPeerManagerEventEmitter.dispatchEvent).to.be.a("function");
    });

    it("should work with stubbed waku event emitter", () => {
      expect(mockWakuEventEmitter.addEventListener).to.be.a("function");
      expect(mockWakuEventEmitter.removeEventListener).to.be.a("function");
      expect(mockWakuEventEmitter.dispatchEvent).to.be.a("function");
    });

    it("should work with stubbed retrieve function", () => {
      expect(mockQueryGenerator).to.be.a("function");
    });

    it("should work with mock decoders", () => {
      expect(mockDecoders).to.be.an("array");
      expect(mockDecoders[0]).to.have.property("contentTopic");
      expect(mockDecoders[0]).to.have.property("fromWireToProtoObj");
      expect(mockDecoders[0]).to.have.property("fromProtoObj");
    });
  });

  describe("event handling simulation", () => {
    let addEventListenerStub: sinon.SinonStub;
    let healthEventCallback: (event: CustomEvent<HealthStatus>) => void;
    let storeConnectCallback: () => void;

    beforeEach(() => {
      addEventListenerStub = sinon.stub();
      mockPeerManagerEventEmitter.addEventListener = addEventListenerStub;
      mockWakuEventEmitter.addEventListener = sinon
        .stub()
        .callsFake((eventType, callback) => {
          if (eventType === WakuEvent.Health) {
            healthEventCallback = callback;
          }
        });

      queryOnConnect = new QueryOnConnect(
        mockDecoders,
        () => false,
        mockPeerManagerEventEmitter,
        mockWakuEventEmitter,
        mockQueryGenerator,
        options
      );
    });

    it("should capture event listeners for testing", () => {
      queryOnConnect.start();

      expect(
        addEventListenerStub.calledWith(PeerManagerEventNames.StoreConnect)
      ).to.be.true;

      storeConnectCallback = addEventListenerStub.getCall(0).args[1];
      expect(storeConnectCallback).to.be.a("function");
    });

    it("should properly setup health event callback", () => {
      queryOnConnect.start();

      expect(mockWakuEventEmitter.addEventListener).to.be.a("function");
      expect(healthEventCallback).to.be.a("function");
    });
  });

  describe("async generator retrieve function mock", () => {
    it("should work with async generator that yields promises", async () => {
      const mockMessage: IDecodedMessage = {
        hash: new Uint8Array(),
        hashStr: "",
        version: 1,
        timestamp: new Date(),
        contentTopic: "/test/1/content",
        pubsubTopic: "/waku/2/default-waku/proto",
        payload: new Uint8Array([1, 2, 3]),
        rateLimitProof: undefined,
        ephemeral: false,
        meta: undefined
      };

      const mockAsyncGenerator = async function* (): AsyncGenerator<
        Promise<IDecodedMessage | undefined>[]
      > {
        yield [Promise.resolve(mockMessage)];
        yield [Promise.resolve(undefined)];
      };

      mockQueryGenerator.returns(mockAsyncGenerator());

      queryOnConnect = new QueryOnConnect(
        mockDecoders,
        () => false,
        mockPeerManagerEventEmitter,
        mockWakuEventEmitter,
        mockQueryGenerator,
        options
      );

      const generator = mockQueryGenerator(mockDecoders, {});
      const firstPage = await generator.next();
      expect(firstPage.done).to.be.false;

      const messages = await Promise.all(firstPage.value);
      expect(messages[0]).to.deep.equal(mockMessage);
    });

    it("should handle retrieve function with query parameters", async () => {
      const queryParams: Partial<QueryRequestParams> = {
        timeStart: new Date(Date.now() - 1000),
        timeEnd: new Date()
      };

      queryOnConnect = new QueryOnConnect(
        mockDecoders,
        () => false,
        mockPeerManagerEventEmitter,
        mockWakuEventEmitter,
        mockQueryGenerator,
        options
      );

      mockQueryGenerator(mockDecoders, queryParams);

      expect(mockQueryGenerator.calledWith(mockDecoders, queryParams)).to.be
        .true;
    });
  });

  describe("message retrieval event emission conditions", () => {
    let mockClock: sinon.SinonFakeTimers;

    beforeEach(() => {
      mockClock = sinon.useFakeTimers();
      mockClock.tick(10); // always tick as now === 0 messes up the logic

      queryOnConnect = new QueryOnConnect(
        mockDecoders,
        () => false,
        mockPeerManagerEventEmitter,
        mockWakuEventEmitter,
        mockQueryGenerator,
        options
      );
    });

    afterEach(() => {
      sinon.restore();
      mockClock.restore();
    });

    it("should trigger query when it went offline since the last successful query", async () => {
      let healthEventCallback:
        | ((event: CustomEvent<HealthStatus>) => void)
        | undefined;

      // Capture the health event callback
      mockWakuEventEmitter.addEventListener = sinon
        .stub()
        .callsFake((eventType, callback) => {
          if (eventType === WakuEvent.Health) {
            healthEventCallback = callback;
          }
        });

      queryOnConnect.start();

      // Set lastSuccessfulQuery to simulate old query
      await queryOnConnect["maybeQuery"](mockPeerId);
      mockClock.tick(1);

      // goes offline
      const healthEvent = new CustomEvent<HealthStatus>("health", {
        detail: HealthStatus.Unhealthy
      });
      expect(healthEventCallback).to.not.be.undefined;
      healthEventCallback!.call(queryOnConnect, healthEvent);
      mockClock.tick(1);

      // Call maybeQuery directly to test condition
      await queryOnConnect["maybeQuery"](mockPeerId);

      expect(mockQueryGenerator.calledTwice).to.be.true;
    });

    it("should not trigger query if health event is healthy since last successful query", async () => {
      queryOnConnect.start();

      // Set lastSuccessfulQuery to simulate old query
      await queryOnConnect["maybeQuery"](mockPeerId);

      // goes offline
      const healthEvent = new CustomEvent<HealthStatus>("health", {
        detail: HealthStatus.SufficientlyHealthy
      });
      mockWakuEventEmitter.dispatchEvent(healthEvent);

      // Call maybeQuery directly to test condition
      await queryOnConnect["maybeQuery"](mockPeerId);

      expect(mockQueryGenerator.calledOnce).to.be.true;
    });

    it("should trigger query when time since last query exceeds threshold", async function () {
      const customThreshold = 10;
      const customOptions: QueryOnConnectOptions = {
        forceQueryThresholdMs: customThreshold
      };

      const queryOnConnect = new QueryOnConnect(
        mockDecoders,
        () => false,
        mockPeerManagerEventEmitter,
        mockWakuEventEmitter,
        mockQueryGenerator,
        customOptions
      );
      queryOnConnect.start();

      // Set lastSuccessfulQuery to simulate old query
      await queryOnConnect["maybeQuery"](mockPeerId);

      // Advance fake timer over the force threshold
      mockClock.tick(20);

      // Call maybeQuery directly to test condition
      await queryOnConnect["maybeQuery"](mockPeerId);

      expect(mockQueryGenerator.calledTwice).to.be.true;
    });

    it("should not trigger query when a recent query happened under threshold", async () => {
      const customThreshold = 2000;
      const customOptions: QueryOnConnectOptions = {
        forceQueryThresholdMs: customThreshold
      };

      queryOnConnect = new QueryOnConnect(
        mockDecoders,
        () => false,
        mockPeerManagerEventEmitter,
        mockWakuEventEmitter,
        mockQueryGenerator,
        customOptions
      );

      queryOnConnect.start();

      // First call to set a successful call
      await queryOnConnect["maybeQuery"](mockPeerId);

      // Second call should not trigger
      await queryOnConnect["maybeQuery"](mockPeerId);

      expect(mockQueryGenerator.calledOnce).to.be.true;
    });
  });

  describe("end-to-end message emission tests", () => {
    let storeConnectCallback: (event: CustomEvent<PeerId>) => void;
    let healthEventCallback: (event: CustomEvent<HealthStatus>) => void;
    let messageEventPromise: Promise<IDecodedMessage[]>;
    let resolveMessageEvent: (messages: IDecodedMessage[]) => void;
    let rejectMessageEvent: (reason: string) => void;
    let connectStoreEvent: CustomEvent<PeerId>;
    let timeoutId: NodeJS.Timeout;

    beforeEach(() => {
      // Create a promise that resolves when a message event is emitted
      messageEventPromise = new Promise<IDecodedMessage[]>(
        (resolve, reject) => {
          resolveMessageEvent = resolve;
          rejectMessageEvent = reject;
        }
      );

      // Setup event listener capture with proper binding
      mockPeerManagerEventEmitter.addEventListener = sinon
        .stub()
        .callsFake((eventType, callback) => {
          if (eventType === PeerManagerEventNames.StoreConnect) {
            storeConnectCallback = callback;
          }
        });

      mockWakuEventEmitter.addEventListener = sinon
        .stub()
        .callsFake((eventType, callback) => {
          if (eventType === WakuEvent.Health) {
            healthEventCallback = callback;
          }
        });

      queryOnConnect = new QueryOnConnect(
        mockDecoders,
        () => false,
        mockPeerManagerEventEmitter,
        mockWakuEventEmitter,
        mockQueryGenerator,
        options
      );

      // Listen for message events
      queryOnConnect.addEventListener(
        QueryOnConnectEvent.MessagesRetrieved,
        (event: CustomEvent<IDecodedMessage[]>) => {
          clearTimeout(timeoutId);
          resolveMessageEvent(event.detail);
        }
      );

      connectStoreEvent = new CustomEvent<PeerId>("connect:store", {
        detail: mockPeerId
      });

      // Set a timeout to reject if no message is received
      timeoutId = setTimeout(
        () => rejectMessageEvent("No message received within timeout"),
        500
      );
    });

    afterEach(() => {
      clearTimeout(timeoutId);
    });

    it("should emit message when we just started and store connect event occurs", async () => {
      const mockMessage: IDecodedMessage = {
        hash: utf8ToBytes("1234"),
        hashStr: "1234",
        version: 1,
        timestamp: new Date(),
        contentTopic: "/test/offline/content",
        pubsubTopic: "/waku/2/default-waku/proto",
        payload: new Uint8Array([1, 2, 3]),
        rateLimitProof: undefined,
        ephemeral: false,
        meta: undefined
      };

      // Setup retrieve function to return the mock message
      const mockAsyncGenerator = async function* (): AsyncGenerator<
        Promise<IDecodedMessage | undefined>[]
      > {
        yield [Promise.resolve(mockMessage)];
      };
      mockQueryGenerator.returns(mockAsyncGenerator());

      queryOnConnect.start();

      // Step 2: Simulate store peer reconnection
      storeConnectCallback.call(queryOnConnect, connectStoreEvent);

      // Step 4: Wait for message emission
      const receivedMessage = await messageEventPromise;

      expect(receivedMessage).to.deep.equal([mockMessage]);
      expect(mockQueryGenerator.calledOnce).to.be.true;
    });

    it("should emit message when we went offline since last successful query and store reconnect event occurs", async () => {
      const mockMessage: IDecodedMessage = {
        hash: new Uint8Array(),
        hashStr: "1234",
        version: 1,
        timestamp: new Date(),
        contentTopic: "/test/offline/content",
        pubsubTopic: "/waku/2/default-waku/proto",
        payload: new Uint8Array([1, 2, 3]),
        rateLimitProof: undefined,
        ephemeral: false,
        meta: undefined
      };

      // Setup retrieve function to return the mock message
      const mockAsyncGenerator = async function* (): AsyncGenerator<
        Promise<IDecodedMessage | undefined>[]
      > {
        yield [Promise.resolve(mockMessage)];
      };
      mockQueryGenerator.returns(mockAsyncGenerator());

      queryOnConnect.start();

      // Step 1: Simulate successful query in the past
      await queryOnConnect["maybeQuery"](mockPeerId);
      await delay(100);

      // Step 2: Simulate going offline after the successful query
      const healthEvent = new CustomEvent<HealthStatus>("health", {
        detail: HealthStatus.Unhealthy
      });
      healthEventCallback.call(queryOnConnect, healthEvent);

      // Step 3: Simulate store peer reconnection
      storeConnectCallback.call(queryOnConnect, connectStoreEvent);

      // Step 4: Wait for message emission
      const receivedMessages = await messageEventPromise;

      expect(receivedMessages).to.deep.equal([mockMessage]);
      expect(mockQueryGenerator.calledTwice).to.be.true;
    });

    it("should emit message when store reconnect event occurs and last query was over max time threshold", async () => {
      const mockMessage: IDecodedMessage = {
        hash: new Uint8Array(),
        hashStr: "",
        version: 1,
        timestamp: new Date(),
        contentTopic: "/test/timeout/content",
        pubsubTopic: "/waku/2/default-waku/proto",
        payload: new Uint8Array([4, 5, 6]),
        rateLimitProof: undefined,
        ephemeral: false,
        meta: undefined
      };

      // Setup retrieve function to return the mock message
      const mockAsyncGenerator = async function* (): AsyncGenerator<
        Promise<IDecodedMessage | undefined>[]
      > {
        yield [Promise.resolve(mockMessage)];
      };
      mockQueryGenerator.returns(mockAsyncGenerator());

      queryOnConnect = new QueryOnConnect(
        mockDecoders,
        () => false,
        mockPeerManagerEventEmitter,
        mockWakuEventEmitter,
        mockQueryGenerator,
        { forceQueryThresholdMs: 5000 } // 5 second threshold
      );

      // Re-setup event listeners for new instance
      queryOnConnect.addEventListener(
        QueryOnConnectEvent.MessagesRetrieved,
        (event: CustomEvent<IDecodedMessage[]>) => {
          resolveMessageEvent(event.detail);
        }
      );

      queryOnConnect.start();

      // Step 1: Simulate old successful query (over threshold)
      await queryOnConnect["maybeQuery"](mockPeerId);

      // Step 3: Simulate store peer reconnection
      storeConnectCallback.call(queryOnConnect, connectStoreEvent);

      // Step 4: Wait for message emission
      const receivedMessages = await messageEventPromise;

      expect(receivedMessages).to.deep.equal([mockMessage]);
      expect(mockQueryGenerator.calledOnce).to.be.true;
    });

    it("should emit multiple messages when query returns multiple messages", async () => {
      const mockMessage1: IDecodedMessage = {
        hash: new Uint8Array(),
        hashStr: "",
        version: 1,
        timestamp: new Date(),
        contentTopic: "/test/multi/content1",
        pubsubTopic: "/waku/2/default-waku/proto",
        payload: new Uint8Array([1, 2, 3]),
        rateLimitProof: undefined,
        ephemeral: false,
        meta: undefined
      };

      const mockMessage2: IDecodedMessage = {
        hash: new Uint8Array(),
        hashStr: "",
        version: 1,
        timestamp: new Date(),
        contentTopic: "/test/multi/content2",
        pubsubTopic: "/waku/2/default-waku/proto",
        payload: new Uint8Array([4, 5, 6]),
        rateLimitProof: undefined,
        ephemeral: false,
        meta: undefined
      };

      // Setup retrieve function to return multiple messages
      const mockAsyncGenerator = async function* (): AsyncGenerator<
        Promise<IDecodedMessage | undefined>[]
      > {
        yield [Promise.resolve(mockMessage1)];
        yield [Promise.resolve(mockMessage2)];
      };
      mockQueryGenerator.returns(mockAsyncGenerator());

      const receivedMessages: IDecodedMessage[] = [];
      let messageCount = 0;

      // Create a new promise for multiple messages
      const multipleMessagesPromise = new Promise<void>((resolve) => {
        queryOnConnect.addEventListener(
          QueryOnConnectEvent.MessagesRetrieved,
          (event: CustomEvent<IDecodedMessage[]>) => {
            receivedMessages.push(...event.detail);
            messageCount++;
            if (messageCount === 2) {
              resolve();
            }
          }
        );
      });

      queryOnConnect.start();

      storeConnectCallback.call(queryOnConnect, connectStoreEvent);

      // Wait for all messages with timeout
      await Promise.race([
        multipleMessagesPromise,
        delay(200).then(() =>
          Promise.reject(new Error("Timeout waiting for messages"))
        )
      ]);

      expect(receivedMessages).to.have.length(2);
      expect(receivedMessages[0]).to.deep.equal(mockMessage1);
      expect(receivedMessages[1]).to.deep.equal(mockMessage2);
      expect(mockQueryGenerator.calledOnce).to.be.true;
    });

    it("should not emit message when conditions are not met (recent query, no offline)", async () => {
      queryOnConnect.start();

      await queryOnConnect["maybeQuery"](mockPeerId);

      // Override promise to reject if any message is received
      queryOnConnect.addEventListener(
        QueryOnConnectEvent.MessagesRetrieved,
        () => {
          rejectMessageEvent("Unexpected message emission");
        }
      );

      await delay(10);
      storeConnectCallback.call(queryOnConnect, connectStoreEvent);

      // Wait briefly to ensure no message is emitted
      await delay(50);

      expect(mockQueryGenerator.calledOnce).to.be.true;
    });

    it("should handle retrieve errors gracefully without emitting messages", async () => {
      // Setup retrieve function to throw an error
      mockQueryGenerator.rejects(new Error("Retrieval failed"));

      queryOnConnect.start();

      // Override promise to reject if any message is received
      queryOnConnect.addEventListener(
        QueryOnConnectEvent.MessagesRetrieved,
        (_event: CustomEvent<IDecodedMessage[]>) => {
          rejectMessageEvent("Unexpected message emission after error");
        }
      );

      await queryOnConnect["maybeQuery"](mockPeerId);
      storeConnectCallback.call(queryOnConnect, connectStoreEvent);

      // Wait briefly to ensure no message is emitted
      await delay(100);

      expect(mockQueryGenerator.calledTwice).to.be.true;
    });
  });

  describe("stopIfTrue predicate", () => {
    beforeEach(() => {
      mockPeerManagerEventEmitter.addEventListener = sinon.stub();
      mockWakuEventEmitter.addEventListener = sinon.stub();
    });

    it("should stop query iteration when stopIfTrue returns true", async () => {
      const messages = [
        {
          hash: new Uint8Array(),
          hashStr: "msg1",
          version: 1,
          timestamp: new Date(),
          contentTopic: "/test/1/content",
          pubsubTopic: "/waku/2/default-waku/proto",
          payload: new Uint8Array([1]),
          rateLimitProof: undefined,
          ephemeral: false,
          meta: undefined
        },
        {
          hash: new Uint8Array(),
          hashStr: "stop-hash",
          version: 1,
          timestamp: new Date(),
          contentTopic: "/test/1/content",
          pubsubTopic: "/waku/2/default-waku/proto",
          payload: new Uint8Array([2]),
          rateLimitProof: undefined,
          ephemeral: false,
          meta: undefined
        },
        {
          hash: new Uint8Array(),
          hashStr: "msg3",
          version: 1,
          timestamp: new Date(),
          contentTopic: "/test/1/content",
          pubsubTopic: "/waku/2/default-waku/proto",
          payload: new Uint8Array([3]),
          rateLimitProof: undefined,
          ephemeral: false,
          meta: undefined
        }
      ];

      // Setup generator to yield 3 pages, stop should occur on page 2
      const mockAsyncGenerator = async function* (): AsyncGenerator<
        Promise<IDecodedMessage | undefined>[]
      > {
        yield [Promise.resolve(messages[0])];
        yield [Promise.resolve(messages[1])];
        yield [Promise.resolve(messages[2])];
      };
      mockQueryGenerator.returns(mockAsyncGenerator());

      const stopPredicate = (msg: IDecodedMessage): boolean =>
        msg.hashStr === "stop-hash";

      queryOnConnect = new QueryOnConnect(
        mockDecoders,
        stopPredicate,
        mockPeerManagerEventEmitter,
        mockWakuEventEmitter,
        mockQueryGenerator,
        options
      );

      const receivedMessages: IDecodedMessage[] = [];
      queryOnConnect.addEventListener(
        QueryOnConnectEvent.MessagesRetrieved,
        (event: CustomEvent<IDecodedMessage[]>) => {
          receivedMessages.push(...event.detail);
        }
      );

      queryOnConnect.start();
      await queryOnConnect["maybeQuery"](mockPeerId);

      // Should have received messages from first 2 pages only
      expect(receivedMessages).to.have.length(2);
      expect(receivedMessages[0].hashStr).to.equal("msg1");
      expect(receivedMessages[1].hashStr).to.equal("stop-hash");
    });

    it("should process all pages when stopIfTrue never returns true", async () => {
      const messages = [
        {
          hash: new Uint8Array(),
          hashStr: "msg1",
          version: 1,
          timestamp: new Date(),
          contentTopic: "/test/1/content",
          pubsubTopic: "/waku/2/default-waku/proto",
          payload: new Uint8Array([1]),
          rateLimitProof: undefined,
          ephemeral: false,
          meta: undefined
        },
        {
          hash: new Uint8Array(),
          hashStr: "msg2",
          version: 1,
          timestamp: new Date(),
          contentTopic: "/test/1/content",
          pubsubTopic: "/waku/2/default-waku/proto",
          payload: new Uint8Array([2]),
          rateLimitProof: undefined,
          ephemeral: false,
          meta: undefined
        },
        {
          hash: new Uint8Array(),
          hashStr: "msg3",
          version: 1,
          timestamp: new Date(),
          contentTopic: "/test/1/content",
          pubsubTopic: "/waku/2/default-waku/proto",
          payload: new Uint8Array([3]),
          rateLimitProof: undefined,
          ephemeral: false,
          meta: undefined
        }
      ];

      const mockAsyncGenerator = async function* (): AsyncGenerator<
        Promise<IDecodedMessage | undefined>[]
      > {
        yield [Promise.resolve(messages[0])];
        yield [Promise.resolve(messages[1])];
        yield [Promise.resolve(messages[2])];
      };
      mockQueryGenerator.returns(mockAsyncGenerator());

      const stopPredicate = (): boolean => false;

      queryOnConnect = new QueryOnConnect(
        mockDecoders,
        stopPredicate,
        mockPeerManagerEventEmitter,
        mockWakuEventEmitter,
        mockQueryGenerator,
        options
      );

      const receivedMessages: IDecodedMessage[] = [];
      queryOnConnect.addEventListener(
        QueryOnConnectEvent.MessagesRetrieved,
        (event: CustomEvent<IDecodedMessage[]>) => {
          receivedMessages.push(...event.detail);
        }
      );

      queryOnConnect.start();
      await queryOnConnect["maybeQuery"](mockPeerId);

      // Should have received all 3 messages
      expect(receivedMessages).to.have.length(3);
    });

    it("should stop on first message of a page if stopIfTrue matches", async () => {
      const messages = [
        {
          hash: new Uint8Array(),
          hashStr: "stop-hash",
          version: 1,
          timestamp: new Date(),
          contentTopic: "/test/1/content",
          pubsubTopic: "/waku/2/default-waku/proto",
          payload: new Uint8Array([1]),
          rateLimitProof: undefined,
          ephemeral: false,
          meta: undefined
        },
        {
          hash: new Uint8Array(),
          hashStr: "msg2",
          version: 1,
          timestamp: new Date(),
          contentTopic: "/test/1/content",
          pubsubTopic: "/waku/2/default-waku/proto",
          payload: new Uint8Array([2]),
          rateLimitProof: undefined,
          ephemeral: false,
          meta: undefined
        },
        {
          hash: new Uint8Array(),
          hashStr: "msg3",
          version: 1,
          timestamp: new Date(),
          contentTopic: "/test/1/content",
          pubsubTopic: "/waku/2/default-waku/proto",
          payload: new Uint8Array([3]),
          rateLimitProof: undefined,
          ephemeral: false,
          meta: undefined
        }
      ];

      const mockAsyncGenerator = async function* (): AsyncGenerator<
        Promise<IDecodedMessage | undefined>[]
      > {
        yield [
          Promise.resolve(messages[0]),
          Promise.resolve(messages[1]),
          Promise.resolve(messages[2])
        ];
      };
      mockQueryGenerator.returns(mockAsyncGenerator());

      const stopPredicate = (msg: IDecodedMessage): boolean =>
        msg.hashStr === "stop-hash";

      queryOnConnect = new QueryOnConnect(
        mockDecoders,
        stopPredicate,
        mockPeerManagerEventEmitter,
        mockWakuEventEmitter,
        mockQueryGenerator,
        options
      );

      const receivedMessages: IDecodedMessage[] = [];
      queryOnConnect.addEventListener(
        QueryOnConnectEvent.MessagesRetrieved,
        (event: CustomEvent<IDecodedMessage[]>) => {
          receivedMessages.push(...event.detail);
        }
      );

      queryOnConnect.start();
      await queryOnConnect["maybeQuery"](mockPeerId);

      // Should have received all 3 messages from the page, even though first matched
      expect(receivedMessages).to.have.length(3);
      expect(receivedMessages[0].hashStr).to.equal("stop-hash");
      expect(receivedMessages[1].hashStr).to.equal("msg2");
      expect(receivedMessages[2].hashStr).to.equal("msg3");
    });
  });
});

describe("calculateTimeRange", () => {
  it("should return start time to last successful query since last query is less than max range", () => {
    const now = 1000000; // Some arbitrary timestamp
    const lastSuccessfulQuery = now - 100; // 100ms ago
    const maxTimeRangeQueryMs = 500; // 500ms max range

    const result = calculateTimeRange(
      now,
      lastSuccessfulQuery,
      maxTimeRangeQueryMs
    );

    const expectedTimeStart = new Date(lastSuccessfulQuery);
    const expectedTimeEnd = new Date(now);

    expect(result.timeStart).to.deep.equal(expectedTimeStart);
    expect(result.timeEnd).to.deep.equal(expectedTimeEnd);
  });

  it("should return start time to match max range", () => {
    const now = 1000000;
    const lastSuccessfulQuery = 1000000 - 800; // 800ms ago
    const maxTimeRangeQueryMs = 500; // 500ms max range

    const result = calculateTimeRange(
      now,
      lastSuccessfulQuery,
      maxTimeRangeQueryMs
    );

    const expectedTimeStart = new Date(now - maxTimeRangeQueryMs);
    const expectedTimeEnd = new Date(now);

    expect(result.timeStart).to.deep.equal(expectedTimeStart);
    expect(result.timeEnd).to.deep.equal(expectedTimeEnd);
  });

  it("should handle zero lastSuccessfulQuery (never queried before)", () => {
    const now = 1000000;
    const lastSuccessfulQuery = 0; // Never queried
    const maxTimeRangeQueryMs = 500;

    const result = calculateTimeRange(
      now,
      lastSuccessfulQuery,
      maxTimeRangeQueryMs
    );

    const expectedTimeStart = new Date(now - maxTimeRangeQueryMs); // 1000000 - 1000000 = 0
    const expectedTimeEnd = new Date(now); // 1000000

    expect(result.timeStart).to.deep.equal(expectedTimeStart);
    expect(result.timeEnd).to.deep.equal(expectedTimeEnd);
  });
});
