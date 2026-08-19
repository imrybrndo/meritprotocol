/**
 * The bridge.
 *
 * Everything the renderer can do is enumerated here. There is deliberately no
 * generic `invoke(channel, ...)` escape hatch — that would let renderer-side
 * code reach any handler the main process happens to register, which is the
 * usual way a context-isolated app leaks its privileges back to web content.
 */

import { contextBridge, ipcRenderer } from "electron";

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

const call = <T>(channel: string, ...args: unknown[]): Promise<Result<T>> =>
  ipcRenderer.invoke(channel, ...args);

const on = (channel: string, listener: (payload: never) => void) => {
  const wrapped = (_event: unknown, payload: never) => listener(payload);
  ipcRenderer.on(channel, wrapped as never);
  return () => ipcRenderer.removeListener(channel, wrapped as never);
};

contextBridge.exposeInMainWorld("merit", {
  vault: {
    status: () => call("vault:status"),
    setSecret: (name: string, value: string) => call("vault:setSecret", name, value),
    clearSecret: (name: string) => call("vault:clearSecret", name),
    setBaseUrl: (url: string) => call("vault:setBaseUrl", url),
  },
  wallet: {
    status: () => call("wallet:status"),
    balance: () => call("wallet:balance"),
    create: (passphrase: string, replace?: boolean) =>
      call("wallet:create", passphrase, replace),
    import: (mnemonic: string, passphrase: string) => call("wallet:import", mnemonic, passphrase),
    importKey: (secret: string, passphrase: string) => call("wallet:importKey", secret, passphrase),
    unlock: (passphrase: string) => call("wallet:unlock", passphrase),
    reveal: (passphrase: string) => call("wallet:reveal", passphrase),
    revealKey: (passphrase: string) => call("wallet:revealKey", passphrase),
    forget: () => call("wallet:forget"),
  },
  auth: {
    state: () => call("auth:state"),
    signIn: (baseUrl: string) => call("auth:signIn", baseUrl),
    signOut: () => call("auth:signOut"),
  },
  agent: {
    config: (patch?: unknown) => call("agent:config", patch),
    models: () => call("agent:models"),
  },
  trade: {
    account: () => call("trade:account"),
    funding: () => call("trade:funding"),
    deposit: (amount: number) => call("trade:deposit", amount),
    verifySigning: () => call("trade:verifySigning"),
    leverage: (symbol: string, leverage: number) => call("trade:leverage", symbol, leverage),
    agents: () => call("trade:agents"),
    agent: (agentId: string) => call("trade:agent", agentId),
    place: (input: unknown) => call("trade:place", input),
  },
  protocol: {
    health: () => call("merit:health"),
    agents: () => call("merit:agents"),
    decisions: (query: { agentId?: string; status?: string }) => call("merit:decisions", query),
  },
  venues: {
    positions: () => call("venues:positions"),
  },
  market: {
    list: () => call("market:list"),
    overview: () => call("market:overview"),
    candles: (symbol: string, timeframe: string) => call("market:candles", symbol, timeframe),
    logos: () => call("market:logos"),
    book: (symbol: string) => call("market:book", symbol),
    snapshot: (symbol: string, timeframe: string) => call("market:snapshot", symbol, timeframe),
  },
  chat: {
    send: (text: string) => call("chat:send", text),
    reset: () => call("chat:reset"),
    approve: (id: string, approved: boolean) => call("chat:approve", id, approved),
    onText: (fn: (delta: string) => void) => on("chat:text", fn as never),
    onTool: (fn: (name: string) => void) => on("chat:tool", fn as never),
    onApproval: (fn: (request: unknown) => void) => on("chat:approval", fn as never),
    onApprovalSettled: (fn: (id: string) => void) => on("chat:approvalSettled", fn as never),
  },
});
