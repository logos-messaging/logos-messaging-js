import { BytesUtils } from "./bytes.js";

const DefaultEpochUnitSeconds = 10; // the rln-relay epoch length in seconds

export function dateToEpoch(
  timestamp: Date,
  epochUnitSeconds: number = DefaultEpochUnitSeconds
): number {
  const time = timestamp.getTime();
  const epoch = Math.floor(time / 1000 / epochUnitSeconds);
  return epoch;
}

export function epochIntToBytes(epoch: number): Uint8Array {
  return BytesUtils.writeUIntLE(new Uint8Array(32), epoch, 0, 32);
}

export function epochBytesToInt(bytes: Uint8Array): number {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const epoch = dv.getUint32(0, true);
  return epoch;
}

export function dateToEpochSeconds(timestamp: Date): number {
  return Math.floor(timestamp.getTime() / 1000);
}

export function dateToEpochBytes(timestamp: Date): Uint8Array {
  return epochIntToBytes(dateToEpochSeconds(timestamp));
}

export function dateToNanosecondBytes(timestamp: Date): Uint8Array {
  const nanoseconds = BigInt(timestamp.getTime()) * 1000000n;
  return BytesUtils.bytes32FromBigInt(nanoseconds, "little");
}
