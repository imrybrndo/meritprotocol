/**
 * Electron main process.
 *
 * Security posture: the renderer is untrusted web content. It runs sandboxed
 * with context isolation and no Node integration, and reaches privileged
 * capability only through the narrow IPC surface registered below. Credentials
 * and network calls stay on this side of the bridge.
 */

import { app, BrowserWindow, Menu, ipcMain, nativeImage, shell } from "electron";
import { join } from "node:path";
import * as vault from "./vault";
import * as merit from "./merit";
import { getVenueAdapter } from "./venues";
import * as market from "./hyperliquid";
import * as rwa from "./rwa";
import * as wallet from "./wallet";
import * as trade from "./trade";
import * as deposit from "./deposit";
import * as claude from "./claude";
import * as openrouter from "./openrouter";
import { resolveApproval } from "./agent-tools";

const PRODUCT = "MERIT";

/**
 * Ships beside the bundle, so one path holds for a `npm start` run and for a
 * packaged app.
 */
function appIcon(): Electron.NativeImage | null {
  const icon = nativeImage.createFromPath(join(__dirname, "icon.png"));
  return icon.isEmpty() ? null : icon;
}

/**
 * Branding a dev run would otherwise take from Electron itself: the Dock icon,
 * the About panel, and the application menu.
 *
 * The app name is deliberately NOT set with `app.setName`. Electron derives the
 * userData path from it, so renaming would orphan the wallet and vault already
 * on this machine and present as a fresh install.
 */
function applyBranding(): void {
  const icon = appIcon();
  if (icon && process.platform === "darwin") app.dock?.setIcon(icon);

  app.setAboutPanelOptions({
    applicationName: PRODUCT,
    applicationVersion: app.getVersion(),
    credits: "Commit the call before the outcome.",
    ...(icon ? { iconPath: join(__dirname, "icon.png") } : {}),
  });

  // Replacing the default menu drops Electron's own name and dev entries. Every
  // item is a role, so copy, paste and the standard shortcuts keep working
  // exactly as they did.
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...(process.platform === "darwin"
        ? ([
            {
              label: PRODUCT,
              submenu: [
                { role: "about", label: `About ${PRODUCT}` },
                { type: "separator" },
                { role: "services" },
                { type: "separator" },
                { role: "hide", label: `Hide ${PRODUCT}` },
                { role: "hideOthers" },
                { role: "unhide" },
                { type: "separator" },
                { role: "quit", label: `Quit ${PRODUCT}` },
              ],
            },
          ] as Electron.MenuItemConstructorOptions[])
        : []),
      {
        label: "Edit",
        submenu: [
          { role: "undo" },
          { role: "redo" },
          { type: "separator" },
          { role: "cut" },
          { role: "copy" },
          { role: "paste" },
          { role: "selectAll" },
        ],
      },
      {
        label: "View",
        submenu: [
          { role: "reload" },
          { role: "toggleDevTools" },
          { type: "separator" },
          { role: "resetZoom" },
          { role: "zoomIn" },
          { role: "zoomOut" },
          { type: "separator" },
          { role: "togglefullscreen" },
        ],
      },
      { label: "Window", submenu: [{ role: "minimize" }, { role: "zoom" }, { role: "close" }] },
    ]),
  );
}

let window: BrowserWindow | null = null;

function createWindow(): void {
  window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 940,
    minHeight: 600,
    title: "MERIT PROTOCOL",
    // macOS takes its icon from the Dock call above; this is what Windows and
    // Linux draw in the title bar and the task switcher.
    ...(process.platform === "darwin" ? {} : { icon: appIcon() ?? undefined }),
    backgroundColor: "#08090b",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    webPreferences: {
      preload: join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  window.loadFile(join(__dirname, "renderer/index.html"));

  // Renderer errors are otherwise invisible from the terminal, which makes a
  // blocked script or a CSP rejection look identical to a hung request.
  window.webContents.on("console-message", (_event, _level, message, line, source) => {
    console.log(`[renderer] ${message} (${source}:${line})`);
  });

  // External links open in the user's browser, never as in-app navigation.
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event) => event.preventDefault());
}

function send(channel: string, payload: unknown): void {
  window?.webContents.send(channel, payload);
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Wrap a handler so a thrown error becomes a typed result, not an IPC rejection. */
function handle<T>(channel: string, fn: (...args: never[]) => Promise<T> | T): void {
  ipcMain.handle(channel, async (_event, ...args) => {
    try {
      return { ok: true as const, data: await fn(...(args as never[])) };
    } catch (error) {
      return { ok: false as const, error: toMessage(error) };
    }
  });
}

app.whenReady().then(() => {
  applyBranding();

  handle("vault:status", () => vault.status());
  handle("vault:setSecret", (name: vault.CredentialName, value: string) => {
    vault.setSecret(name, value);
    return vault.status();
  });
  handle("vault:clearSecret", (name: vault.CredentialName) => {
    vault.clearSecret(name);
    return vault.status();
  });
  handle("vault:setBaseUrl", (url: string) => {
    vault.setBaseUrl(url);
    return vault.status();
  });

  /* ---------------------------------------------------------------- wallet -- */

  handle("wallet:status", () => wallet.status());
  handle("wallet:balance", () => wallet.balance());

  /**
   * The seed phrase crosses to the renderer exactly once, so the operator can
   * write it down. It is never persisted in plaintext, on either side.
   */
  handle("wallet:create", (passphrase: string, replace?: boolean) =>
    wallet.create(passphrase, { replace }),
  );
  handle("wallet:import", (mnemonic: string, passphrase: string) =>
    wallet.importMnemonic(mnemonic, passphrase),
  );
  handle("wallet:importKey", (secret: string, passphrase: string) =>
    wallet.importSecretKey(secret, passphrase),
  );
  handle("wallet:unlock", (passphrase: string) => wallet.unlock(passphrase));
  handle("wallet:reveal", (passphrase: string) => wallet.revealMnemonic(passphrase));
  handle("wallet:revealKey", (passphrase: string) => wallet.revealPrivateKey(passphrase));
  handle("wallet:forget", () => {
    wallet.forget();
    vault.clearSecret("meritApiKey");
    return wallet.status();
  });

  /**
   * Sign in with the wallet: the deployment issues a nonce, the key on this
   * machine signs it, and a valid signature comes back as an API key. Nothing
   * is stored until the deployment has accepted the signature.
   */
  handle("auth:signIn", async (rawUrl: string) => {
    const baseUrl = vault.normalizeBaseUrl(rawUrl);
    if (!/^https?:\/\//i.test(baseUrl)) {
      throw new Error("The deployment must be an http:// or https:// URL.");
    }

    const address = wallet.address();
    const challenge = await merit.walletChallenge(address, baseUrl);
    const signature = await wallet.signMessage(challenge.message);

    const result = await merit.walletSignIn(
      { address, nonce: challenge.nonce, signature },
      baseUrl,
    );

    vault.setBaseUrl(baseUrl);
    vault.setSecret("meritApiKey", result.apiKey);

    return {
      session: result.session,
      account: result.account,
      status: vault.status(),
      wallet: wallet.status(),
    };
  });

  /**
   * What the window should show at startup. A rejected key drops the operator
   * back to the gate; an unreachable deployment does not — being offline is not
   * a reason to throw someone out of a console they are already signed in to.
   */
  handle("auth:state", async () => {
    const status = vault.status();
    const walletStatus = wallet.status();

    // A locked wallet is not a session, whatever the vault still holds: the
    // console must not sign anything the operator has not just unlocked.
    if (!walletStatus.unlocked || !status.meritApiKey) {
      return { signedIn: false as const, status, wallet: walletStatus };
    }

    try {
      return {
        signedIn: true as const,
        session: await merit.session(),
        status,
        wallet: walletStatus,
      };
    } catch (error) {
      if (error instanceof merit.MeritApiError && (error.status === 401 || error.status === 403)) {
        return { signedIn: false as const, status, wallet: walletStatus, rejected: error.message };
      }
      return {
        signedIn: true as const,
        session: null,
        status,
        wallet: walletStatus,
        offline: toMessage(error),
      };
    }
  });

  /**
   * Signing out locks the wallet and drops the API key. The wallet file stays —
   * signing out is not "forget my account", and the passphrase brings it back.
   */
  handle("auth:signOut", () => {
    wallet.lock();
    vault.clearSecret("meritApiKey");
    return { status: vault.status(), wallet: wallet.status() };
  });

  handle("merit:health", () => merit.health());
  handle("merit:agents", () => merit.listAgents());
  handle("merit:decisions", (query: { agentId?: string; status?: string }) =>
    merit.listDecisions(query ?? {}),
  );

  // Named for what they return, not for the venue behind them — the venue has
  // already changed once.
  handle("market:list", () => market.listMarkets());
  handle("market:overview", () => market.overview());
  handle("market:candles", (symbol: string, timeframe: market.Timeframe) =>
    market.candles(symbol, timeframe),
  );
  handle("market:logos", () => market.logos());
  handle("market:book", (symbol: string) => market.book(symbol));

  /* --------------------------------------------------------------- trading -- */

  handle("trade:account", () => trade.accountState(wallet.address()));
  handle("trade:funding", () => deposit.fundingState());
  handle("trade:deposit", (amount: number) => deposit.deposit(amount));
  handle("trade:verifySigning", () => trade.verifySigning());
  handle("trade:leverage", (symbol: string, leverage: number) =>
    trade.setLeverage(symbol, leverage),
  );
  handle("trade:agents", () => merit.listAgents());
  handle("trade:agent", (agentId: string) => merit.getAgent(agentId));

  /**
   * Seal, then send — in that order, in one place.
   *
   * The ordering is the product: a commitment written after the fill is known
   * proves nothing. It is enforced here rather than in the renderer so that no
   * window, and no future caller, can send an order that was never committed.
   *
   * If the seal fails, nothing is sent. If the send fails after a successful
   * seal, the commitment stands — the decision was genuinely made, and MERIT
   * records decisions, not fills. The outcome is revealed later, or not at all.
   */
  handle(
    "trade:place",
    async (input: {
      symbol: string;
      side: "long" | "short";
      size: number;
      limitPrice?: number;
      agentId: string;
      confidence: string;
      rationale: string;
    }) => {
      const agent = await merit.getAgent(input.agentId);
      const version =
        agent.strategyVersions.find((entry) => entry.status === "ACTIVE") ??
        agent.strategyVersions[0];
      if (!version) {
        throw new Error(`${agent.name} has no strategy version to commit under.`);
      }

      const mark = input.limitPrice ?? (await market.book(input.symbol)).bids[0]?.[0];
      if (!mark) throw new Error(`No price available for ${input.symbol}.`);

      const commitment = await merit.commitDecision({
        agentId: input.agentId,
        strategyVersionId: version.id,
        asset: input.symbol,
        action: input.side === "long" ? "BUY" : "SHORT",
        price: String(mark),
        quantity: String(input.size),
        confidence: input.confidence,
        metadata: {
          rationale: input.rationale,
          venue: "hyperliquid",
          source: "merit-console",
          orderType: input.limitPrice === undefined ? "market" : "limit",
        },
        idempotencyKey: `console-${Date.now()}-${input.symbol}-${input.side}`,
      });

      const receipt = await trade.placeOrder({
        symbol: input.symbol,
        side: input.side,
        size: input.size,
        limitPrice: input.limitPrice,
      });

      return { commitment, receipt };
    },
  );
  handle("market:snapshot", (symbol: string, timeframe: market.Timeframe) =>
    market.snapshot(symbol, timeframe),
  );

  // `force` skips the module's own cache, for the panel's refresh button.
  handle("rwa:snapshot", (force?: boolean) => rwa.snapshot(Boolean(force)));
  handle("rwa:logos", () => rwa.logos());

  handle("venues:positions", async () => {
    const adapter = getVenueAdapter();
    return {
      name: adapter.name,
      connected: adapter.connected,
      perps: await adapter.perpPositions(),
      lp: await adapter.lpPositions(),
    };
  });

  handle("chat:reset", () => {
    // Both histories, whichever provider is live: switching provider mid-thread
    // must not leave the other one holding half a conversation.
    claude.resetConversation();
    openrouter.resetConversation();
    return true;
  });

  handle("agent:config", (patch?: Partial<vault.AgentConfig>) =>
    patch ? vault.setAgentConfig(patch) : vault.getAgentConfig(),
  );
  handle("agent:models", () => openrouter.listModels());
  handle("chat:approve", (id: string, approved: boolean) => {
    resolveApproval(id, approved);
    return true;
  });
  handle("chat:send", async (text: string) => {
    // `send` is already the IPC helper in this file.
    const ask =
      vault.getAgentConfig().provider === "openrouter"
        ? openrouter.sendMessage
        : claude.sendMessage;

    await ask(text, {
      onText: (delta) => send("chat:text", delta),
      onToolStart: (name) => send("chat:tool", name),
      onApprovalNeeded: (request) => send("chat:approval", request),
      onApprovalSettled: (id) => send("chat:approvalSettled", id),
    });
    return true;
  });

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
