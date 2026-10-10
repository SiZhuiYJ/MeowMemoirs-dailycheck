import * as signalR from '@microsoft/signalr';

export * from '@microsoft/signalr';

export type SignalRNamespace = typeof signalR;

export async function loadSignalR(): Promise<SignalRNamespace> {
  return signalR;
}