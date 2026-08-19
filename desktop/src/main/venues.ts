/**
 * VenueAdapter — the seam where live venue data would enter.
 *
 * Modelled on the protocol's AnchorService: the interface is defined here so a
 * real integration (Drift, Jupiter, Orca) is an added adapter rather than a
 * rewrite of the console.
 *
 * The console ships with the disconnected adapter only, and it is deliberately
 * honest about that — it reports `connected: false` and returns no positions,
 * rather than inventing plausible-looking ones. A workspace that displayed
 * fabricated perp or LP positions would be exactly the failure MERIT exists to
 * make impossible, so the empty state is the correct state until someone wires
 * a venue up.
 */

export interface PerpPosition {
  venue: string;
  asset: string;
  side: "LONG" | "SHORT";
  size: string;
  entryPrice: string;
  markPrice: string;
  unrealizedPnl: string;
  /** Decision this position was committed under, when the operator linked one. */
  decisionId: string | null;
}

export interface LpPosition {
  venue: string;
  pool: string;
  liquidity: string;
  feesEarned: string;
  inRange: boolean;
}

export interface VenueAdapter {
  readonly name: string;
  readonly connected: boolean;
  perpPositions(): Promise<PerpPosition[]>;
  lpPositions(): Promise<LpPosition[]>;
}

class DisconnectedVenueAdapter implements VenueAdapter {
  readonly name = "none";
  readonly connected = false;

  async perpPositions(): Promise<PerpPosition[]> {
    return [];
  }

  async lpPositions(): Promise<LpPosition[]> {
    return [];
  }
}

let adapter: VenueAdapter = new DisconnectedVenueAdapter();

export function getVenueAdapter(): VenueAdapter {
  return adapter;
}

export function setVenueAdapter(next: VenueAdapter): void {
  adapter = next;
}
