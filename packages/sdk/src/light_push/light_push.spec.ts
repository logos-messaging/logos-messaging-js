import { Peer, PeerId } from "@libp2p/interface";
import {
  createEncoder,
  Encoder,
  LightPushCodec,
  LightPushCodecV2
} from "@waku/core";
import { Libp2p, LightPushError, LightPushStatusCode } from "@waku/interfaces";
import { createRoutingInfo } from "@waku/utils";
import { utf8ToBytes } from "@waku/utils/bytes";
import { expect } from "chai";
import { afterEach } from "mocha";
import sinon, { SinonSpy } from "sinon";

import { PeerManager } from "../peer_manager/index.js";

import { LightPush } from "./light_push.js";

const testContentTopic = "/test/1/waku-light-push/utf8";
const testRoutingInfo = createRoutingInfo(
  {
    clusterId: 0,
    numShardsInCluster: 7
  },
  { contentTopic: testContentTopic }
);

describe("LightPush SDK", () => {
  let libp2p: Libp2p;
  let encoder: Encoder;
  let lightPush: LightPush;

  beforeEach(() => {
    libp2p = mockLibp2p();
    encoder = createEncoder({
      contentTopic: testContentTopic,
      routingInfo: testRoutingInfo
    });
    lightPush = mockLightPush({ libp2p });
  });

  afterEach(() => {
    sinon.restore();
  });

  it("should fail to send if no connected peers found", async () => {
    const result = await lightPush.send(encoder, {
      payload: utf8ToBytes("test")
    });
    const failures = result.failures ?? [];

    expect(failures.length).to.be.eq(1);
    expect(failures.some((v) => v.error === LightPushError.NO_PEER_AVAILABLE))
      .to.be.true;
  });

  it("should send to specified number of peers of used peers", async () => {
    libp2p = mockLibp2p({
      peers: [mockPeer("1"), mockPeer("2"), mockPeer("3"), mockPeer("4")]
    });

    lightPush = mockLightPush({ libp2p, numPeersToUse: 2 });
    let sendSpy = sinon.spy(
      (_encoder: any, _message: any, peerId: PeerId) =>
        Promise.resolve({ success: peerId }) as any
    );
    lightPush["protocol"].send = sendSpy;

    let result = await lightPush.send(encoder, {
      payload: utf8ToBytes("test")
    });

    expect(sendSpy.calledTwice, "1").to.be.true;
    expect(result.successes?.length, "2").to.be.eq(2);

    // check if setting another value works
    lightPush = mockLightPush({ libp2p, numPeersToUse: 3 });
    sendSpy = sinon.spy(
      (_encoder: any, _message: any, peerId: PeerId) =>
        Promise.resolve({ success: peerId }) as any
    );
    lightPush["protocol"].send = sendSpy;

    result = await lightPush.send(encoder, { payload: utf8ToBytes("test") });

    expect(sendSpy.calledThrice, "3").to.be.true;
    expect(result.successes?.length, "4").to.be.eq(3);
  });

  it("should retry on complete failure if specified", async () => {
    libp2p = mockLibp2p({
      peers: [mockPeer("1"), mockPeer("2")]
    });

    lightPush = mockLightPush({ libp2p });
    const sendSpy = sinon.spy((_encoder: any, _message: any, _peerId: PeerId) =>
      Promise.resolve({ failure: { error: "problem" } })
    );
    lightPush["protocol"].send = sendSpy as any;

    const retryPushSpy = (lightPush as any)["retryManager"].push as SinonSpy;
    const result = await lightPush.send(
      encoder,
      { payload: utf8ToBytes("test") },
      { autoRetry: true }
    );

    expect(retryPushSpy.callCount).to.be.eq(1);
    expect(result.failures?.length).to.be.eq(2);
  });

  it("should not retry if at least one success", async () => {
    libp2p = mockLibp2p({
      peers: [mockPeer("1"), mockPeer("2")]
    });

    lightPush = mockLightPush({ libp2p });
    const sendSpy = sinon.spy(
      (_encoder: any, _message: any, peerId: PeerId) => {
        if (peerId.toString() === "1") {
          return Promise.resolve({ success: peerId });
        }

        return Promise.resolve({ failure: { error: "problem" } });
      }
    );
    lightPush["protocol"].send = sendSpy as any;
    const retryPushSpy = (lightPush as any)["retryManager"].push as SinonSpy;

    const result = await lightPush.send(
      encoder,
      { payload: utf8ToBytes("test") },
      { autoRetry: true }
    );

    expect(retryPushSpy.callCount).to.be.eq(0);
    expect(result.successes?.length).to.be.eq(1);
    expect(result.failures?.length).to.be.eq(1);
  });

  describe("v3 protocol support", () => {
    it("should work with v3 peers", async () => {
      libp2p = mockLibp2p({
        peers: [mockV3Peer("1"), mockV3Peer("2")]
      });
    });

    it("should work with mixed v2 and v3 peers", async () => {
      libp2p = mockLibp2p({
        peers: [mockV2AndV3Peer("1"), mockPeer("2"), mockV3Peer("3")]
      });

      // Mock responses for different protocol versions
      const v3Response = mockV3SuccessResponse(5);
      const v2Response = mockV2SuccessResponse();
      const v3ErrorResponse = mockV3ErrorResponse(
        LightPushStatusCode.PAYLOAD_TOO_LARGE
      );
      const v2ErrorResponse = mockV2ErrorResponse("Message too large");

      expect(v3Response.statusCode).to.eq(LightPushStatusCode.SUCCESS);
      expect(v3Response.relayPeerCount).to.eq(5);
      expect(v2Response.isSuccess).to.be.true;
      expect(v3ErrorResponse.statusCode).to.eq(
        LightPushStatusCode.PAYLOAD_TOO_LARGE
      );
      expect(v2ErrorResponse.isSuccess).to.be.false;
    });

    it("should handle v3 RLN errors", async () => {
      const v3RLNError = mockV3RLNErrorResponse();
      const v2RLNError = mockV2RLNErrorResponse();

      expect(v3RLNError.statusCode).to.eq(LightPushStatusCode.NO_RLN_PROOF);
      expect(v3RLNError.statusDesc).to.include("RLN proof generation failed");
      expect(v2RLNError.info).to.include("RLN proof generation failed");
    });
  });
});

type MockLibp2pOptions = {
  peers?: Peer[];
};

function mockLibp2p(options?: MockLibp2pOptions): Libp2p {
  const peers = options?.peers || [];
  const peerStore = {
    get: (id: any) => {
      const peer = peers.find((p) => p.id === id);
      if (peer) {
        return Promise.resolve({
          ...peer,
          protocols: peer.protocols || [LightPushCodec]
        });
      }
      return Promise.resolve(undefined);
    }
  };

  return {
    peerStore,
    getPeers: () => peers.map((p) => p.id),
    components: {
      events: new EventTarget(),
      connectionManager: {
        getConnections: () => []
      } as any,
      peerStore
    }
  } as unknown as Libp2p;
}

type MockLightPushOptions = {
  libp2p: Libp2p;
  pubsubTopics?: string[];
  numPeersToUse?: number;
};

function mockLightPush(options: MockLightPushOptions): LightPush {
  const lightPush = new LightPush({
    peerManager: {
      getPeers: () =>
        options.libp2p
          .getPeers()
          .slice(0, options.numPeersToUse || options.libp2p.getPeers().length)
    } as unknown as PeerManager,
    libp2p: options.libp2p,
    options: {
      numPeersToUse: options.numPeersToUse
    }
  });

  (lightPush as any)["retryManager"] = {
    push: sinon.spy()
  };

  return lightPush;
}

function mockPeer(id: string, protocols: string[] = [LightPushCodec]): Peer {
  return {
    id: { toString: () => id } as PeerId,
    protocols: protocols,
    metadata: new Map(),
    addresses: [],
    tags: new Map()
  };
}

// V3-specific mock functions
function mockV3Peer(id: string): Peer {
  return mockPeer(id, [LightPushCodec]);
}

function mockV2AndV3Peer(id: string): Peer {
  return mockPeer(id, [LightPushCodec, LightPushCodecV2]);
}

function mockV3SuccessResponse(relayPeerCount?: number): {
  statusCode: LightPushStatusCode;
  statusDesc: string;
  relayPeerCount?: number;
  isSuccess: boolean;
} {
  return {
    statusCode: LightPushStatusCode.SUCCESS,
    statusDesc: "Message sent successfully",
    relayPeerCount,
    isSuccess: true
  };
}

function mockV3ErrorResponse(
  statusCode: LightPushStatusCode,
  statusDesc?: string
): {
  statusCode: LightPushStatusCode;
  statusDesc: string;
  isSuccess: boolean;
} {
  return {
    statusCode,
    statusDesc: statusDesc || "Error occurred",
    isSuccess: false
  };
}

function mockV2SuccessResponse(): {
  isSuccess: boolean;
  info: string;
} {
  return {
    isSuccess: true,
    info: "Message sent successfully"
  };
}

function mockV2ErrorResponse(info?: string): {
  isSuccess: boolean;
  info: string;
} {
  return {
    isSuccess: false,
    info: info || "Error occurred"
  };
}

function mockV3RLNErrorResponse(): {
  statusCode: LightPushStatusCode;
  statusDesc: string;
  isSuccess: boolean;
} {
  return {
    statusCode: LightPushStatusCode.NO_RLN_PROOF,
    statusDesc: "RLN proof generation failed",
    isSuccess: false
  };
}

function mockV2RLNErrorResponse(): {
  isSuccess: boolean;
  info: string;
} {
  return {
    isSuccess: false,
    info: "RLN proof generation failed"
  };
}
