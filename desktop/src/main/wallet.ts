/**
 * The operator wallet.
 *
 * An EVM keypair generated on this machine and never sent anywhere. It is the
 * account: signing a challenge with it is how the console authenticates, and it
 * is what will sign trades.
 *
 * Custody rules, in order of importance:
 *
 *  1. The secret key exists in the main process only, and only while unlocked.
 *     The renderer can ask for a signature; it can never ask for a key.
 *  2. At rest the seed phrase is encrypted with a password the operator picks —
 *     scrypt to a 32-byte key, then AES-256-GCM. The password is never stored,
 *     so a stolen wallet file is worth nothing without it. Note it is a local
 *     password, not a BIP-39 passphrase: the twelve words alone restore this
 *     account in any other wallet.
 *  3. Derivation is the Ethereum standard m/44'/60'/0'/0/0, and signatures are
 *     EIP-191 personal_sign, so the same twelve words restore this account in
 *     MetaMask or Rabby and the signature verifies with any EVM tooling. None
 *     of this is proprietary to MERIT.
 *
 * A wallet can also be imported as a bare private key, which has no phrase
 * behind it. `source` records which, because the difference is not cosmetic:
 * a key-imported wallet has no twelve words to show, and telling someone
 * otherwise would send them looking for a backup that never existed.
 */

import { app } from "electron";
import {
  formatEther,
  HDNodeWallet,
  JsonRpcProvider,
  Mnemonic,
  Wallet,
  type BaseWallet,
} from "ethers";
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** Ethereum account 0. MetaMask, Rabby and Coinbase Wallet all use this path. */
const DERIVATION_PATH = "m/44'/60'/0'/0/0";

/**
 * ~128 MB and roughly a second per attempt on current hardware. That cost is
 * the whole defence for a file someone else may end up holding.
 */
const SCRYPT = { N: 2 ** 17, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };

export const MIN_PASSPHRASE_LENGTH = 10;

/** What the ciphertext holds. Absent on files written before key import existed. */
type WalletSource = "mnemonic" | "secretKey";

interface WalletFile {
  version: 1;
  address: string;
  createdAt: string;
  source?: WalletSource;
  kdf: { salt: string; N: number; r: number; p: number };
  cipher: { iv: string; tag: string; data: string };
}

export class WalletError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WalletError";
  }
}

function walletPath(): string {
  return join(app.getPath("userData"), "wallet.json");
}

function read(): WalletFile | null {
  const path = walletPath();
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as WalletFile;
  } catch {
    throw new WalletError("The wallet file on this machine is unreadable. Restore from your seed phrase.");
  }
}

function derive(mnemonic: string): HDNodeWallet {
  return HDNodeWallet.fromMnemonic(Mnemonic.fromPhrase(mnemonic), DERIVATION_PATH);
}

function encrypt(secret: string, password: string): WalletFile["cipher"] & { salt: string } {
  const salt = randomBytes(16);
  const key = scryptSync(password, salt, 32, SCRYPT);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);

  return {
    salt: salt.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    data: data.toString("base64"),
  };
}

function decrypt(file: WalletFile, password: string): string {
  const key = scryptSync(password, Buffer.from(file.kdf.salt, "base64"), 32, {
    N: file.kdf.N,
    r: file.kdf.r,
    p: file.kdf.p,
    maxmem: SCRYPT.maxmem,
  });

  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(file.cipher.iv, "base64"));
  decipher.setAuthTag(Buffer.from(file.cipher.tag, "base64"));

  try {
    return Buffer.concat([
      decipher.update(Buffer.from(file.cipher.data, "base64")),
      decipher.final(),
    ]).toString("utf8");
    // GCM authentication fails on any wrong password, so this is also the
    // password check — there is no separate, weaker one to attack.
  } catch {
    throw new WalletError("That password does not open this wallet.");
  }
}

function persist(
  secret: string,
  password: string,
  address: string,
  source: WalletSource,
): void {
  if (password.length < MIN_PASSPHRASE_LENGTH) {
    throw new WalletError(`Use at least ${MIN_PASSPHRASE_LENGTH} characters — this password is the only thing protecting the key on disk.`);
  }

  const { salt, ...cipher } = encrypt(secret, password);
  const file: WalletFile = {
    version: 1,
    address,
    createdAt: new Date().toISOString(),
    source,
    kdf: { salt, N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p },
    cipher,
  };

  const path = walletPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(file, null, 2), { mode: 0o600 });
}

/* ------------------------------------------------------------- unlocked -- */

/** Present only between unlock and lock. Never serialised, never sent anywhere. */
let unlocked: BaseWallet | null = null;

/** An address this build can actually derive to. */
function isEvmAddress(value: string | undefined): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(value ?? "");
}

export interface WalletStatus {
  exists: boolean;
  unlocked: boolean;
  address: string | null;
  /**
   * A wallet written by the Solana build. The password would open the file, but
   * the key inside is on a different curve — this build can never produce that
   * address, so the file is unusable rather than merely locked.
   */
  legacy: boolean;
}

export function status(): WalletStatus {
  const file = read();
  const address = unlocked?.address ?? file?.address ?? null;
  return {
    exists: file !== null,
    unlocked: unlocked !== null,
    address,
    legacy: file !== null && !isEvmAddress(file.address),
  };
}

/**
 * Create a wallet. The phrase is returned exactly once, for the operator to
 * write down — it is not stored anywhere in plaintext, including here.
 *
 * `replace` must be passed to write over a wallet already on this machine.
 * Importing has always overwritten, and refusing here only made the two paths
 * inconsistent: an operator sent to this screen — by a wallet the build cannot
 * open, or by Back from import — hit a wall with no way forward. The guard
 * stays as a backstop, but the decision belongs to the person, who is asked
 * before we get here.
 */
export function create(
  password: string,
  options: { replace?: boolean } = {},
): { mnemonic: string; address: string } {
  if (read() && !options.replace) {
    throw new WalletError(
      "This machine already holds a wallet. Confirm the replacement, or remove it first.",
    );
  }

  const wallet = Wallet.createRandom();
  const mnemonic = wallet.mnemonic?.phrase;
  if (!mnemonic) throw new WalletError("Could not generate a recovery phrase on this machine.");

  persist(mnemonic, password, wallet.address, "mnemonic");
  unlocked = wallet;

  return { mnemonic, address: wallet.address };
}

/** Restore from twelve words produced here, by MetaMask, or by any BIP-39 wallet. */
export function importMnemonic(mnemonic: string, password: string): { address: string } {
  const phrase = mnemonic.trim().toLowerCase().split(/\s+/).join(" ");

  let wallet: HDNodeWallet;
  try {
    wallet = derive(phrase);
  } catch {
    throw new WalletError("That is not a valid seed phrase. Check the spelling and the word order.");
  }

  persist(phrase, password, wallet.address, "mnemonic");
  unlocked = wallet;

  return { address: wallet.address };
}

/**
 * Parse an EVM private key: 32 bytes as hex, with or without the 0x prefix —
 * the shape MetaMask, Rabby and Foundry all export.
 */
function parseSecretKey(input: string): Wallet {
  const trimmed = input.trim();
  const hex = trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`;

  if (!/^0x[0-9a-fA-F]{64}$/.test(hex)) {
    const digits = hex.replace(/^0x/, "").length;
    throw new WalletError(
      `A private key is 64 hex characters; this one has ${digits}.`,
    );
  }

  try {
    return new Wallet(hex);
  } catch {
    throw new WalletError("That key is not a valid EVM private key.");
  }
}

/**
 * Restore from a bare private key. The wallet works exactly as a phrase-imported
 * one does, except there is no phrase to show — see `revealMnemonic`.
 */
export function importSecretKey(input: string, password: string): { address: string } {
  const wallet = parseSecretKey(input);

  persist(wallet.privateKey, password, wallet.address, "secretKey");
  unlocked = wallet;

  return { address: wallet.address };
}

export function unlock(password: string): { address: string } {
  const file = read();
  if (!file) throw new WalletError("There is no wallet on this machine yet.");

  // Caught before the password is even checked: no amount of correct password
  // turns an ed25519 key into an EVM account, and "wrong password" would be a
  // lie about what actually went wrong.
  if (!isEvmAddress(file.address)) {
    throw new WalletError(
      "This wallet was created when the console was on Solana, so this build cannot open it. " +
        "Import an EVM seed phrase or private key, or remove it and create a new wallet.",
    );
  }

  const secret = decrypt(file, password);
  const wallet = file.source === "secretKey" ? new Wallet(secret) : derive(secret);

  // A file whose address does not match what it decrypts to has been tampered
  // with or hand-edited; refuse rather than sign with an unexpected key.
  if (wallet.address !== file.address) {
    throw new WalletError("This wallet file does not match its own address. Restore from your seed phrase.");
  }

  unlocked = wallet;
  return { address: wallet.address };
}

export function lock(): void {
  unlocked = null;
}

/** Re-authenticate to show the phrase again, for a backup the operator lost. */
export function revealMnemonic(password: string): string {
  const file = read();
  if (!file) throw new WalletError("There is no wallet on this machine yet.");
  if (!isEvmAddress(file.address)) {
    throw new WalletError("This wallet predates the move to EVM and can no longer be opened.");
  }
  if (file.source === "secretKey") {
    throw new WalletError(
      "This wallet was imported from a private key, so it has no seed phrase. " +
        "Its backup is the key you imported.",
    );
  }
  return decrypt(file, password);
}

/**
 * The private key itself, re-authenticated.
 *
 * Derived from the file rather than from the unlocked wallet in memory, so it
 * costs a password every time — an unlocked console is not consent to export
 * the key. For a phrase wallet this is the key the phrase derives to; for a
 * key-imported wallet it is the same key that was imported.
 */
export function revealPrivateKey(password: string): string {
  const file = read();
  if (!file) throw new WalletError("There is no wallet on this machine yet.");
  if (!isEvmAddress(file.address)) {
    throw new WalletError("This wallet predates the move to EVM and can no longer be opened.");
  }

  const secret = decrypt(file, password);
  const wallet = file.source === "secretKey" ? new Wallet(secret) : derive(secret);
  return wallet.privateKey;
}

/** Erase the wallet from this machine. Only the seed phrase can bring it back. */
export function forget(): void {
  lock();
  const path = walletPath();
  if (existsSync(path)) rmSync(path);
}

/**
 * The unlocked wallet itself, for the one caller that must sign with it.
 *
 * Exported deliberately narrowly: it is reachable from the main process only,
 * and there is no IPC channel that returns it. A renderer can ask for an order
 * to be signed; it can never obtain the thing that signs.
 */
export function signer(): BaseWallet {
  if (!unlocked) throw new WalletError("The wallet is locked. Unlock it to trade.");
  return unlocked;
}

export function address(): string {
  if (!unlocked) throw new WalletError("The wallet is locked.");
  return unlocked.address;
}

/**
 * Sign text as EIP-191 personal_sign — the scheme every EVM wallet and verifier
 * already speaks, so the deployment needs no MERIT-specific recovery code.
 */
export async function signMessage(message: string): Promise<string> {
  if (!unlocked) throw new WalletError("The wallet is locked.");
  return unlocked.signMessage(message);
}

/* -------------------------------------------------------------- balance -- */

/**
 * Public mainnet RPCs, tried in order. Free endpoints come and go — Cloudflare's
 * answers eth_getBalance with an internal error and Ankr now demands a key — so
 * one hardcoded URL is a balance that silently stops working. Anything heavier
 * than this (trading) will need an endpoint the operator configures.
 */
const RPC_URLS = ["https://ethereum-rpc.publicnode.com", "https://1rpc.io/eth"];

/**
 * On-chain ETH balance. Reads the address, which is public — so this works
 * whether or not the wallet is unlocked.
 */
export async function balance(): Promise<{ address: string; eth: number }> {
  const file = read();
  const target = unlocked?.address ?? file?.address;
  if (!target) throw new WalletError("There is no wallet on this machine yet.");

  for (const url of RPC_URLS) {
    try {
      const wei = await new JsonRpcProvider(url, undefined, { staticNetwork: true }).getBalance(
        target,
      );
      return { address: target, eth: Number(formatEther(wei)) };
    } catch {
      // Try the next endpoint; only report once they have all refused.
    }
  }

  // ethers' own message is a wall of JSON-RPC payload. The card has room for a
  // sentence, and the address is fine — it is the lookup that failed.
  throw new WalletError("No public RPC would answer for the balance just now.");
}
