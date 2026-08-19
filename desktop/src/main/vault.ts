/**
 * Credential vault.
 *
 * Keys live in the main process only. The renderer never receives one — it asks
 * the main process to perform an authenticated call and gets back the result,
 * so a compromised renderer can make requests but cannot exfiltrate the
 * credential itself.
 *
 * At rest, values are encrypted with Electron's safeStorage, which is backed by
 * the OS keychain (Keychain on macOS, libsecret on Linux, DPAPI on Windows).
 * When the platform has no backend available, we refuse to write rather than
 * silently persisting plaintext secrets to disk.
 */

import { app, safeStorage } from "electron";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

export type CredentialName = "meritApiKey" | "anthropicApiKey" | "openrouterApiKey";

/** Which service answers the chat panel, and on what model. */
export type AgentProvider = "anthropic" | "openrouter";

export interface AgentConfig {
  provider: AgentProvider;
  /** Only meaningful for OpenRouter; Anthropic's model is pinned in code. */
  openrouterModel: string;
}

const DEFAULT_AGENT: AgentConfig = { provider: "anthropic", openrouterModel: "" };

interface VaultFile {
  /** base64 of the safeStorage ciphertext, keyed by credential name. */
  secrets: Partial<Record<CredentialName, string>>;
  meritBaseUrl: string;
  /** Not a secret, so it is stored in the clear beside them. */
  agent?: AgentConfig;
}

const DEFAULT_BASE_URL = "http://localhost:3000";

function vaultPath(): string {
  return join(app.getPath("userData"), "vault.json");
}

function read(): VaultFile {
  const path = vaultPath();
  if (!existsSync(path)) return { secrets: {}, meritBaseUrl: DEFAULT_BASE_URL, agent: DEFAULT_AGENT };

  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<VaultFile>;
    return {
      secrets: parsed.secrets ?? {},
      meritBaseUrl: parsed.meritBaseUrl || DEFAULT_BASE_URL,
      agent: { ...DEFAULT_AGENT, ...parsed.agent },
    };
  } catch {
    // A corrupt vault must not brick the app; the user can re-enter credentials.
    return { secrets: {}, meritBaseUrl: DEFAULT_BASE_URL, agent: DEFAULT_AGENT };
  }
}

function write(file: VaultFile): void {
  const path = vaultPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(file, null, 2), { mode: 0o600 });
}

export class EncryptionUnavailableError extends Error {
  constructor() {
    super(
      "This system has no OS keyring available, so credentials cannot be stored " +
        "encrypted. Refusing to write them in plaintext.",
    );
    this.name = "EncryptionUnavailableError";
  }
}

export function setSecret(name: CredentialName, value: string): void {
  if (!safeStorage.isEncryptionAvailable()) throw new EncryptionUnavailableError();

  const file = read();
  file.secrets[name] = safeStorage.encryptString(value).toString("base64");
  write(file);
}

export function getSecret(name: CredentialName): string | null {
  const stored = read().secrets[name];
  if (!stored) return null;

  try {
    return safeStorage.decryptString(Buffer.from(stored, "base64"));
  } catch {
    // Keychain entry was invalidated (OS reinstall, profile move). Treat as absent.
    return null;
  }
}

export function clearSecret(name: CredentialName): void {
  const file = read();
  delete file.secrets[name];
  write(file);
}

export function getBaseUrl(): string {
  return read().meritBaseUrl;
}

/**
 * Normalise a deployment URL. Exported because sign-in has to talk to the
 * endpoint before it is stored, and it must talk to exactly the URL that will
 * end up in the vault.
 */
export function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, "") || DEFAULT_BASE_URL;
}

export function setBaseUrl(url: string): void {
  const file = read();
  file.meritBaseUrl = normalizeBaseUrl(url);
  write(file);
}

export function getAgentConfig(): AgentConfig {
  return { ...DEFAULT_AGENT, ...read().agent };
}

export function setAgentConfig(patch: Partial<AgentConfig>): AgentConfig {
  const file = read();
  file.agent = { ...DEFAULT_AGENT, ...file.agent, ...patch };
  write(file);
  return file.agent;
}

/** What the renderer is allowed to know: whether a credential exists, not its value. */
export function status() {
  return {
    encryptionAvailable: safeStorage.isEncryptionAvailable(),
    meritApiKey: Boolean(getSecret("meritApiKey")),
    anthropicApiKey: Boolean(getSecret("anthropicApiKey")),
    openrouterApiKey: Boolean(getSecret("openrouterApiKey")),
    meritBaseUrl: getBaseUrl(),
    agent: getAgentConfig(),
  };
}
