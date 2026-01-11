import type {
  IEncoder,
  IMessage,
  IProtoMessage,
  IRateLimitProof,
  IRoutingInfo
} from "@waku/interfaces";
import { Logger } from "@waku/utils";

import { RLNCredentialsManager } from "./credentials_manager.js";
import { Proof } from "./proof.js";
import { RLNInstance } from "./rln.js";
import { BytesUtils } from "./utils/bytes.js";
import { dateToNanosecondBytes } from "./utils/epoch.js";

const log = new Logger("waku:rln:encoder");

export class RLNEncoder implements IEncoder {
  public constructor(
    private readonly encoder: IEncoder,
    private readonly rlnInstance: RLNInstance,
    private readonly rateLimit: number,
    private readonly credentialsManager: RLNCredentialsManager
  ) {}

  private toRlnSignal(message: IMessage): Uint8Array {
    if (!message.timestamp)
      throw new Error("RLNEncoder: message must have a timestamp set");
    const contentTopicBytes = new TextEncoder().encode(this.contentTopic);
    const timestampBytes = dateToNanosecondBytes(message.timestamp);

    return BytesUtils.concatenate(
      message.payload,
      contentTopicBytes,
      timestampBytes
    );
  }

  public async toWire(message: IMessage): Promise<Uint8Array | undefined> {
    if (!message.rateLimitProof) {
      message.rateLimitProof = await this.generateProof(message);
      log.info("Proof generated", message.rateLimitProof);
    }
    return this.encoder.toWire(message);
  }

  public async toProtoObj(
    message: IMessage
  ): Promise<IProtoMessage | undefined> {
    const protoMessage = await this.encoder.toProtoObj(message);
    if (!protoMessage) return;

    protoMessage.contentTopic = this.contentTopic;
    if (!message.rateLimitProof) {
      protoMessage.rateLimitProof = await this.generateProof(message);
      log.info("Proof generated", protoMessage.rateLimitProof);
    } else {
      protoMessage.rateLimitProof = message.rateLimitProof;
    }
    return protoMessage;
  }

  private async generateProof(message: IMessage): Promise<IRateLimitProof> {
    if (!message.timestamp)
      throw new Error("RLNEncoder: message must have a timestamp set");
    if (!this.credentialsManager.credentials) {
      throw new Error("RLNEncoder: credentials not set");
    }
    if (
      !this.credentialsManager.pathElements ||
      !this.credentialsManager.identityPathIndex
    ) {
      throw new Error("RLNEncoder: merkle proof not set");
    }
    const signal = this.toRlnSignal(message);
    const { proof, epoch, rlnIdentifier } =
      await this.rlnInstance.zerokit.generateRLNProof(
        signal,
        message.timestamp,
        this.credentialsManager.credentials.identity.IDSecretHash,
        this.credentialsManager.pathElements,
        this.credentialsManager.identityPathIndex,
        this.rateLimit,
        0 // TODO: need to track messages sent per epoch
      );

    return new Proof(proof.toBytesLE(), epoch, rlnIdentifier);
  }

  public get pubsubTopic(): string {
    return this.encoder.pubsubTopic;
  }

  public get routingInfo(): IRoutingInfo {
    return this.encoder.routingInfo;
  }

  public get contentTopic(): string {
    return this.encoder.contentTopic;
  }

  public get ephemeral(): boolean {
    return this.encoder.ephemeral;
  }
}

type RLNEncoderOptions = {
  encoder: IEncoder;
  rlnInstance: RLNInstance;
  credentialsManager: RLNCredentialsManager;
  rateLimit: number;
};

export const createRLNEncoder = (options: RLNEncoderOptions): RLNEncoder => {
  return new RLNEncoder(
    options.encoder,
    options.rlnInstance,
    options.rateLimit,
    options.credentialsManager
  );
};
