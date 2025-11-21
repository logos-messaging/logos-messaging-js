import { HistoryEntry, Message, MessageId, ParticipantId } from "./message.js";

export enum MessageChannelEvent {
  OutMessageSent = "sds:out:message-sent",
  InMessageDelivered = "sds:in:message-delivered",
  InMessageReceived = "sds:in:message-received",
  OutMessageAcknowledged = "sds:out:message-acknowledged",
  OutMessagePossiblyAcknowledged = "sds:out:message-possibly-acknowledged",
  InMessageMissing = "sds:in:message-missing",
  OutSyncSent = "sds:out:sync-sent",
  InSyncReceived = "sds:in:sync-received",
  InMessageLost = "sds:in:message-irretrievably-lost",
  ErrorTask = "sds:error-task",
  // SDS-R Repair Events
  RepairRequestSent = "sds:repair:request-sent",
  RepairRequestReceived = "sds:repair:request-received",
  RepairResponseSent = "sds:repair:response-sent"
}

export type MessageChannelEvents = {
  [MessageChannelEvent.OutMessageSent]: CustomEvent<Message>;
  [MessageChannelEvent.InMessageDelivered]: CustomEvent<MessageId>;
  [MessageChannelEvent.InMessageReceived]: CustomEvent<Message>;
  [MessageChannelEvent.OutMessageAcknowledged]: CustomEvent<MessageId>;
  [MessageChannelEvent.OutMessagePossiblyAcknowledged]: CustomEvent<{
    messageId: MessageId;
    count: number;
  }>;
  [MessageChannelEvent.InMessageMissing]: CustomEvent<HistoryEntry[]>;
  [MessageChannelEvent.InMessageLost]: CustomEvent<HistoryEntry[]>;
  [MessageChannelEvent.OutSyncSent]: CustomEvent<Message>;
  [MessageChannelEvent.InSyncReceived]: CustomEvent<Message>;
  [MessageChannelEvent.ErrorTask]: CustomEvent<unknown>;
  [MessageChannelEvent.RepairRequestSent]: CustomEvent<{
    messageIds: MessageId[];
    carrierMessageId: MessageId;
  }>;
  [MessageChannelEvent.RepairRequestReceived]: CustomEvent<{
    messageIds: MessageId[];
    fromSenderId?: ParticipantId;
  }>;
  [MessageChannelEvent.RepairResponseSent]: CustomEvent<{
    messageId: MessageId;
  }>;
};
