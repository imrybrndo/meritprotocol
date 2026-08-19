/**
 * Icons.
 *
 * The website draws its icons from lucide-react. This window has no React and
 * no network, so the same glyphs live here as raw path data — copied from
 * lucide v1.31.0, the version the site already resolves, rather than redrawn by
 * hand. A check mark in the console is therefore the same check mark the
 * verification report shows in the browser.
 *
 * Nodes are built with createElementNS, like the rest of the renderer: this
 * window never parses markup at runtime, so there is no path by which text
 * from the protocol could be interpreted as elements.
 */

const NS = "http://www.w3.org/2000/svg";

/** [tag, attributes] — the shape lucide itself stores its icons in. */
type Node = [string, Record<string, string>];

/**
 * Keyed by the role the icon plays here, not by its lucide name, so that a
 * later swap of glyph is one line and the call sites keep reading as intent.
 */
const ICONS = {
  /* navigation — one per panel, keyed to match `data-panel`. */
  chat: [
    ["path", { d: "M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z" }],
    ["path", { d: "M7 11h10" }],
    ["path", { d: "M7 15h6" }],
    ["path", { d: "M7 7h8" }],
  ], // message-square-text
  agents: [
    ["path", { d: "M12 8V4H8" }],
    ["rect", { width: "16", height: "12", x: "4", y: "8", rx: "2" }],
    ["path", { d: "M2 14h2" }],
    ["path", { d: "M20 14h2" }],
    ["path", { d: "M15 13v2" }],
    ["path", { d: "M9 13v2" }],
  ], // bot
  perps: [
    ["path", { d: "M9 5v4" }],
    ["rect", { width: "4", height: "6", x: "7", y: "9", rx: "1" }],
    ["path", { d: "M9 15v2" }],
    ["path", { d: "M17 3v2" }],
    ["rect", { width: "4", height: "8", x: "15", y: "5", rx: "1" }],
    ["path", { d: "M17 13v3" }],
    ["path", { d: "M3 3v16a2 2 0 0 0 2 2h16" }],
  ], // chart-candlestick
  lp: [
    ["path", { d: "M7 16.3c2.2 0 4-1.83 4-4.05 0-1.16-.57-2.26-1.71-3.19S7.29 6.75 7 5.3c-.29 1.45-1.14 2.84-2.29 3.76S3 11.1 3 12.25c0 2.22 1.8 4.05 4 4.05z" }],
    ["path", { d: "M12.56 6.6A10.97 10.97 0 0 0 14 3.02c.5 2.5 2 4.9 4 6.5s3 3.5 3 5.5a6.98 6.98 0 0 1-11.91 4.97" }],
  ], // droplets
  settings: [
    ["path", { d: "M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915" }],
    ["circle", { cx: "12", cy: "12", r: "3" }],
  ], // settings

  dashboard: [
    ["rect", { width: "7", height: "9", x: "3", y: "3", rx: "1" }],
    ["rect", { width: "7", height: "5", x: "14", y: "3", rx: "1" }],
    ["rect", { width: "7", height: "9", x: "14", y: "12", rx: "1" }],
    ["rect", { width: "7", height: "5", x: "3", y: "16", rx: "1" }],
  ], // layout-dashboard

  /* actions */
  wallet: [
    ["path", { d: "M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1" }],
    ["path", { d: "M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4" }],
  ], // wallet
  rise: [["path", { d: "M7 7h10v10" }], ["path", { d: "M7 17 17 7" }]], // arrow-up-right
  fall: [["path", { d: "m7 7 10 10" }], ["path", { d: "M17 7v10H7" }]], // arrow-down-right
  external: [
    ["path", { d: "M15 3h6v6" }],
    ["path", { d: "M10 14 21 3" }],
    ["path", { d: "M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" }],
  ], // external-link
  send: [["path", { d: "m5 12 7-7 7 7" }], ["path", { d: "M12 19V5" }]], // arrow-up
  plus: [["path", { d: "M5 12h14" }], ["path", { d: "M12 5v14" }]], // plus
  search: [["path", { d: "m21 21-4.34-4.34" }], ["circle", { cx: "11", cy: "11", r: "8" }]], // search
  next: [["path", { d: "M5 12h14" }], ["path", { d: "m12 5 7 7-7 7" }]], // arrow-right

  /* state — the same three the site's verification report uses. */
  check: [["path", { d: "M20 6 9 17l-5-5" }]], // check
  minus: [["path", { d: "M5 12h14" }]], // minus
  alert: [
    ["path", { d: "m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" }],
    ["path", { d: "M12 9v4" }],
    ["path", { d: "M12 17h.01" }],
  ], // triangle-alert
  seal: [
    ["path", { d: "M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" }],
    ["path", { d: "m9 12 2 2 4-4" }],
  ], // shield-check
  tool: [["path", { d: "M12 19h8" }], ["path", { d: "m4 17 6-6-6-6" }]], // terminal

  /* sign-in */
  lock: [
    ["rect", { width: "18", height: "11", x: "3", y: "11", rx: "2" }],
    ["path", { d: "M7 11V7a5 5 0 0 1 10 0v4" }],
  ], // lock
  signOut: [
    ["path", { d: "m16 17 5-5-5-5" }],
    ["path", { d: "M21 12H9" }],
    ["path", { d: "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" }],
  ], // log-out
  reveal: [
    ["path", { d: "M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" }],
    ["circle", { cx: "12", cy: "12", r: "3" }],
  ], // eye
  conceal: [
    ["path", { d: "M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49" }],
    ["path", { d: "M14.084 14.158a3 3 0 0 1-4.242-4.242" }],
    ["path", { d: "M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143" }],
    ["path", { d: "m2 2 20 20" }],
  ], // eye-off
  // The site spins a Loader2 while a verification is in flight; same glyph,
  // same job, spun by CSS here.
  spinner: [["path", { d: "M21 12a9 9 0 1 1-6.219-8.56" }]], // loader-circle

  /* wallet */
  copy: [
    ["rect", { width: "14", height: "14", x: "8", y: "8", rx: "2", ry: "2" }],
    ["path", { d: "M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" }],
  ], // copy
  chain: [
    ["path", { d: "m10.586 5.414-5.172 5.172" }],
    ["path", { d: "m18.586 13.414-5.172 5.172" }],
    ["path", { d: "M6 12h12" }],
    ["circle", { cx: "12", cy: "20", r: "2" }],
    ["circle", { cx: "12", cy: "4", r: "2" }],
    ["circle", { cx: "20", cy: "12", r: "2" }],
    ["circle", { cx: "4", cy: "12", r: "2" }],
  ], // waypoints
} satisfies Record<string, Node[]>;

export type IconName = keyof typeof ICONS | "mark";

function element(tag: string, attrs: Record<string, string>): SVGElement {
  const node = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  return node;
}

function root(size: number, box: number): SVGSVGElement {
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${box} ${box}`);
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  // Every icon here sits beside its own label, so none of them carry meaning a
  // screen reader would otherwise miss.
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("class", "icon");
  return svg;
}

/**
 * The MERIT mark: a Merkle tree reduced to four leaves folding into two nodes
 * into one root. Geometry copied from components/merit/logo.tsx — it is the
 * product diagram, and it must be the same diagram in both places.
 */
function mark(size: number): SVGSVGElement {
  const svg = root(size, 20);
  svg.setAttribute("fill", "none");
  svg.append(
    element("path", {
      d: "M3 16.5 6.5 11M10 16.5 6.5 11M6.5 11 10 5.5M13.5 11 10 5.5M13.5 11 10 16.5M13.5 11 17 16.5",
      stroke: "currentColor",
      "stroke-width": "1",
      "stroke-opacity": "0.45",
      "stroke-linecap": "round",
    }),
    element("circle", { cx: "3", cy: "16.5", r: "1.5", fill: "currentColor", "fill-opacity": "0.55" }),
    element("circle", { cx: "10", cy: "16.5", r: "1.5", fill: "currentColor", "fill-opacity": "0.55" }),
    element("circle", { cx: "17", cy: "16.5", r: "1.5", fill: "currentColor", "fill-opacity": "0.55" }),
    element("circle", { cx: "6.5", cy: "11", r: "1.6", fill: "currentColor", "fill-opacity": "0.8" }),
    element("circle", { cx: "13.5", cy: "11", r: "1.6", fill: "currentColor", "fill-opacity": "0.8" }),
    element("circle", { cx: "10", cy: "5.5", r: "2.1", fill: "currentColor" }),
  );
  return svg;
}

/** An icon that inherits its colour from the text it sits next to. */
export function icon(name: IconName, size = 16): SVGSVGElement {
  if (name === "mark") return mark(size);

  const svg = root(size, 24);
  // lucide's own defaults, set once on the root so the children inherit them.
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  for (const [tag, attrs] of ICONS[name] as Node[]) svg.append(element(tag, attrs));
  return svg;
}

/**
 * Fill in the icons declared in index.html, so the markup names the glyph it
 * wants (`data-icon`, or `data-icon-end` to trail the label) and the shapes
 * stay defined in exactly one place.
 */
export function hydrateIcons(scope: ParentNode = document): void {
  scope.querySelectorAll<HTMLElement>("[data-icon]").forEach((host) => {
    host.prepend(icon(host.dataset.icon as IconName, Number(host.dataset.iconSize ?? 16)));
    delete host.dataset.icon;
  });
  scope.querySelectorAll<HTMLElement>("[data-icon-end]").forEach((host) => {
    host.append(icon(host.dataset.iconEnd as IconName, Number(host.dataset.iconSize ?? 16)));
    delete host.dataset.iconEnd;
  });
}
