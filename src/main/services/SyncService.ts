import { createHash, randomUUID } from "crypto";
import {
  createReadStream,
  createWriteStream,
  lstatSync,
  mkdirSync,
  readdirSync,
  renameSync,
} from "fs";
import { lstat, mkdir, readdir, rename, rm } from "fs/promises";
import {
  createServer,
  get as httpGet,
  request as httpRequest,
  type ClientRequest,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "http";
import { networkInterfaces } from "os";
import { basename, join, resolve } from "path";
import { Transform } from "stream";
import { pipeline } from "stream/promises";
import { isIP } from "net";
import { getInstanceInfo } from "../instanceInfo";
import { scanModsFolder } from "../modParser";
import { validateInstanceRoot } from "../managedInstances";
import type {
  SyncConnection,
  SyncDiffEntry,
  SyncEvent,
  SyncHostInfo,
  SyncDiffSummary,
  SyncManifestEntry,
} from "../../shared/types";

const MAX_FILE_SIZE = 2 * 1024 * 1024 * 1024;
const MODS_DIR = "mods";
const DISABLED_DIR = "disabledmods";
const STAGING_DIR = ".sync_staging";

interface HostState {
  server: Server;
  instancePath: string;
  emit: (event: SyncEvent | SyncHostEvent) => void;
  info: SyncHostInfo;
  peerManifest: SyncManifestEntry[] | null;
  peerInfo: { name: string; ip: string; connectedAt: number } | null;
}

export type SyncHostEvent =
  | { type: "peer-connected"; connection: SyncConnection }
  | { type: "diff-updated"; diff: SyncDiffEntry[]; summary: SyncDiffSummary }
  | { type: "peer-disconnected" };

let activeHost: HostState | null = null;
const activeTransfers = new Map<string, () => void>();
let streamBufferBytes = 1024 * 1024;
let preferRadminAdapter = true;

export function configureSyncOptions(
  bufferSizeKb: number,
  autoDetectRadmin: boolean,
): void {
  if ([512, 1024, 2048].includes(bufferSizeKb))
    streamBufferBytes = bufferSizeKb * 1024;
  preferRadminAdapter = autoDetectRadmin;
}

function emitSafely<T>(emit: (event: T) => void, event: T): void {
  try {
    emit(event);
  } catch {
    /* The renderer may have closed. */
  }
}

function safeFileName(value: string): string {
  if (
    typeof value !== "string" ||
    value.length < 5 ||
    value.length > 240 ||
    basename(value) !== value ||
    value === "." ||
    value === ".." ||
    /[\\/\0]/.test(value) ||
    !value.toLowerCase().endsWith(".jar")
  )
    throw new Error("Invalid mod file name");
  return value;
}

function safeModId(value: string): string {
  if (typeof value !== "string" || !/^[a-z0-9_.-]{1,128}$/i.test(value)) {
    throw new Error("Invalid mod ID");
  }
  return value;
}

function sha1File(filePath: string): Promise<string> {
  return new Promise((resolveHash, reject) => {
    const hash = createHash("sha1");
    const stream = createReadStream(filePath);
    stream.on("data", (chunk: Buffer | string) => {
      hash.update(chunk);
    });
    stream.once("error", reject);
    stream.once("end", () => resolveHash(hash.digest("hex")));
  });
}

async function modFilesInFolder(folder: string): Promise<string[]> {
  try {
    const entries = await readdir(folder, { withFileTypes: true });
    return entries
      .filter(
        (entry) =>
          entry.isFile() &&
          !entry.isSymbolicLink() &&
          entry.name.toLowerCase().endsWith(".jar"),
      )
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

export async function createSyncManifest(
  instancePath: string,
): Promise<SyncManifestEntry[]> {
  const root = validateInstanceRoot(instancePath);
  const parsedByPath = new Map<
    string,
    { modId: string; version: string; name: string }
  >();
  try {
    const parsed = scanModsFolder(root);
    for (const mod of parsed.mods) {
      parsedByPath.set(resolve(mod.filePath).toLowerCase(), {
        modId: mod.modId,
        version: mod.version,
        name: mod.name,
      });
    }
  } catch {
    // The manifest still includes safely readable jars without recognized metadata.
  }

  const manifest: SyncManifestEntry[] = [];
  for (const [directory, enabled] of [
    [MODS_DIR, true],
    [DISABLED_DIR, false],
  ] as const) {
    const folder = join(root, directory);
    for (const fileName of await modFilesInFolder(folder)) {
      const filePath = join(folder, fileName);
      try {
        const stats = await lstat(filePath);
        if (!stats.isFile() || stats.isSymbolicLink()) continue;
        const parsed = parsedByPath.get(resolve(filePath).toLowerCase());
        const fallback = fileName.replace(/\.jar$/i, "");
        manifest.push({
          fileName,
          size: stats.size,
          sha1: await sha1File(filePath),
          modId:
            parsed?.modId ??
            fallback
              .toLowerCase()
              .replace(/[^a-z0-9_.-]/g, "_")
              .slice(0, 128),
          version: parsed?.version ?? "Unknown",
          name: parsed?.name ?? fallback,
          enabled,
        });
      } catch {
        // A file may be moved while hashing; skip it and let the caller refresh.
      }
    }
  }
  return manifest;
}

function modIdentity(entry: SyncManifestEntry): string {
  const id = entry.modId.trim().toLowerCase();
  if (id && id !== "unknown") return `id:${id}`;
  const base = entry.fileName
    .replace(/\.jar$/i, "")
    .replace(/[-_.]v?\d+(?:[._-]\d+)*.*$/i, "")
    .toLowerCase();
  return `name:${base || entry.fileName.toLowerCase()}`;
}

export function compareSyncManifests(
  local: SyncManifestEntry[],
  peer: SyncManifestEntry[],
): SyncDiffEntry[] {
  const unmatchedPeer = new Set(peer.map((_, index) => index));
  const diff: SyncDiffEntry[] = [];
  for (const localMod of local) {
    let matchIndex = peer.findIndex(
      (candidate, index) =>
        unmatchedPeer.has(index) && candidate.sha1 === localMod.sha1,
    );
    if (matchIndex >= 0) {
      unmatchedPeer.delete(matchIndex);
      diff.push({
        type: "synced",
        key: `${localMod.modId}:${localMod.fileName}`,
        local: localMod,
        peer: peer[matchIndex],
      });
      continue;
    }
    const identity = modIdentity(localMod);
    matchIndex = peer.findIndex(
      (candidate, index) =>
        unmatchedPeer.has(index) && modIdentity(candidate) === identity,
    );
    if (matchIndex >= 0) {
      unmatchedPeer.delete(matchIndex);
      diff.push({
        type: "version_mismatch",
        key: identity,
        local: localMod,
        peer: peer[matchIndex],
      });
    } else {
      diff.push({
        type: "only_local",
        key: `${localMod.modId}:${localMod.fileName}`,
        local: localMod,
      });
    }
  }
  for (const index of unmatchedPeer) {
    const mod = peer[index];
    diff.push({
      type: "only_peer",
      key: `${mod.modId}:${mod.fileName}`,
      peer: mod,
    });
  }
  return diff;
}

export function detectSyncIp(): string {
  const candidates: Array<{ name: string; address: string }> = [];
  for (const [name, addresses] of Object.entries(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (
        address.family === "IPv4" &&
        !address.internal &&
        isIP(address.address) === 4
      ) {
        candidates.push({ name, address: address.address });
      }
    }
  }
  const radmin = candidates.find(
    ({ name, address }) =>
      /radmin\s*vpn/i.test(name) || address.startsWith("26."),
  );
  const standard = candidates.find(
    ({ name, address }) =>
      !/radmin\s*vpn/i.test(name) && !address.startsWith("26."),
  );
  return (
    (preferRadminAdapter ? radmin?.address : standard?.address) ??
    candidates[0]?.address ??
    "127.0.0.1"
  );
}

function respond(res: ServerResponse, status: number, payload: unknown): void {
  const body = Buffer.from(JSON.stringify(payload));
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": body.length,
    "cache-control": "no-store",
  });
  res.end(body);
}

function parseRequestUrl(req: IncomingMessage): URL {
  return new URL(req.url ?? "/", "http://sync.local");
}

async function readJson(
  req: IncomingMessage,
  maxBytes = 16 * 1024,
): Promise<unknown> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += buffer.length;
    if (length > maxBytes) throw new Error("Request body is too large");
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function locateModFile(
  root: string,
  fileName: string,
  enabled: boolean,
): string {
  const safeName = safeFileName(fileName);
  const folder = join(root, enabled ? MODS_DIR : DISABLED_DIR);
  const filePath = join(folder, safeName);
  const stats = lstatSync(filePath);
  if (!stats.isFile() || stats.isSymbolicLink())
    throw new Error("Mod archive is not a regular file");
  return filePath;
}

function decodeHeader(header: string | string[] | undefined): string {
  if (typeof header !== "string" || !/^[a-z0-9_-]+$/i.test(header)) return "";
  try {
    return Buffer.from(header, "base64url").toString("utf8");
  } catch {
    return "";
  }
}

function moveExistingMods(root: string, modId: string, fileName: string): void {
  const identity = modId.toLowerCase();
  let parsed = new Map<string, string>();
  if (identity) {
    try {
      parsed = new Map(
        scanModsFolder(root).mods.map((mod) => [
          resolve(mod.filePath).toLowerCase(),
          mod.modId.toLowerCase(),
        ]),
      );
    } catch {
      // Exact-name replacement is still available without metadata parsing.
    }
  }
  const replacedRoot = join(root, MODS_DIR, STAGING_DIR, "replaced");
  mkdirSync(replacedRoot, { recursive: true });
  for (const directory of [MODS_DIR, DISABLED_DIR]) {
    const folder = join(root, directory);
    for (const candidateName of modFilesInFolderSync(folder)) {
      const candidatePath = join(folder, candidateName);
      const matchesName =
        candidateName.toLowerCase() === fileName.toLowerCase();
      const matchesMod = Boolean(
        identity &&
        parsed.get(resolve(candidatePath).toLowerCase()) === identity,
      );
      if (!matchesName && !matchesMod) continue;
      try {
        const stats = lstatSync(candidatePath);
        if (!stats.isFile() || stats.isSymbolicLink()) continue;
        const backupName = `${Date.now()}_${randomUUID()}_${candidateName}`;
        renameSync(candidatePath, join(replacedRoot, backupName));
      } catch (error) {
        throw new Error(
          `Could not stage the existing ${candidateName}: ${(error as Error).message}`,
        );
      }
    }
  }
}

function modFilesInFolderSync(folder: string): string[] {
  try {
    return readdirSync(folder, { withFileTypes: true })
      .filter(
        (entry) =>
          entry.isFile() &&
          !entry.isSymbolicLink() &&
          entry.name.toLowerCase().endsWith(".jar"),
      )
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

async function receiveUpload(
  req: IncomingMessage,
  root: string,
  emit: (event: SyncEvent) => void,
): Promise<{ fileName: string; modId: string }> {
  const fileName = safeFileName(decodeHeader(req.headers["x-file-name64"]));
  const expectedSha1 = String(req.headers["x-file-sha1"] ?? "").toLowerCase();
  if (!/^[a-f0-9]{40}$/.test(expectedSha1))
    throw new Error("Missing or invalid SHA-1");
  const modId = safeModId(String(req.headers["x-mod-id"] ?? "unknown"));
  try {
    decodeURIComponent(String(req.headers["x-mod-version"] ?? "Unknown"));
  } catch {
    throw new Error("Invalid mod version header");
  }
  const enabled = req.headers["x-enabled"] !== "false";
  const replaceModId = req.headers["x-replace-mod-id"]
    ? safeModId(String(req.headers["x-replace-mod-id"]))
    : "";
  const totalBytes = Number(req.headers["content-length"] ?? 0);
  if (Number.isFinite(totalBytes) && totalBytes > MAX_FILE_SIZE)
    throw new Error("Mod archive exceeds the 2 GB transfer limit");
  const staging = join(root, MODS_DIR, STAGING_DIR);
  await mkdir(staging, { recursive: true });
  const temporaryPath = join(staging, `${fileName}.${randomUUID()}.tmp`);
  const hash = createHash("sha1");
  let bytesTransferred = 0;
  const meter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      bytesTransferred += chunk.length;
      if (bytesTransferred > MAX_FILE_SIZE)
        return callback(
          new Error("Mod archive exceeds the 2 GB transfer limit"),
        );
      hash.update(chunk);
      emitSafely(emit, {
        type: "progress",
        direction: "incoming",
        fileName,
        bytesTransferred,
        totalBytes,
        percent:
          totalBytes > 0
            ? Math.min(100, Math.round((bytesTransferred * 100) / totalBytes))
            : 0,
      });
      callback(null, chunk);
    },
  });
  try {
    await pipeline(
      req,
      meter,
      createWriteStream(temporaryPath, {
        flags: "wx",
        highWaterMark: streamBufferBytes,
      }),
    );
    if (totalBytes > 0 && bytesTransferred !== totalBytes)
      throw new Error("Uploaded file size did not match the transfer header");
    if (hash.digest("hex") !== expectedSha1)
      throw new Error("Uploaded file failed SHA-1 verification");
    moveExistingMods(root, replaceModId || modId, fileName);
    const destination = join(root, enabled ? MODS_DIR : DISABLED_DIR, fileName);
    await mkdir(join(root, enabled ? MODS_DIR : DISABLED_DIR), {
      recursive: true,
    });
    await rename(temporaryPath, destination);
    return { fileName, modId };
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

function summarizeDiff(diff: SyncDiffEntry[]): SyncDiffSummary {
  return {
    only_local: diff.filter((item) => item.type === "only_local").length,
    only_peer: diff.filter((item) => item.type === "only_peer").length,
    version_mismatch: diff.filter((item) => item.type === "version_mismatch")
      .length,
    synced: diff.filter((item) => item.type === "synced").length,
  };
}

function validateManifest(raw: unknown): SyncManifestEntry[] {
  if (!Array.isArray(raw) || raw.length > 20_000) {
    throw new Error("Invalid peer manifest");
  }
  return raw.map((value) => {
    if (typeof value !== "object" || value === null)
      throw new Error("Invalid peer manifest entry");
    const item = value as Partial<SyncManifestEntry>;
    if (
      typeof item.fileName !== "string" ||
      typeof item.size !== "number" ||
      !Number.isSafeInteger(item.size) ||
      item.size < 0 ||
      item.size > MAX_FILE_SIZE ||
      typeof item.sha1 !== "string" ||
      !/^[a-f0-9]{40}$/i.test(item.sha1) ||
      typeof item.modId !== "string" ||
      typeof item.version !== "string" ||
      typeof item.name !== "string" ||
      typeof item.enabled !== "boolean"
    )
      throw new Error("Invalid peer manifest entry");
    return {
      fileName: safeFileName(item.fileName),
      size: item.size,
      sha1: item.sha1.toLowerCase(),
      modId: safeModId(item.modId),
      version: item.version.slice(0, 200),
      name: item.name.slice(0, 300),
      enabled: item.enabled,
    };
  });
}

function peerIpFromRequest(req: IncomingMessage): string {
  return (req.socket.remoteAddress ?? "unknown").replace(/^::ffff:/i, "");
}

async function publishHostDiff(
  state: HostState,
  peerName?: string,
  peerIp?: string,
): Promise<void> {
  if (!state.peerManifest || !state.peerInfo) return;
  const localManifest = await createSyncManifest(state.instancePath);
  const connection: SyncConnection = {
    peerIp: state.peerInfo.ip,
    peerPort: state.info.port,
    peerName: state.peerInfo.name,
    localName: state.info.instanceName,
    pingMs: 0,
    localManifest,
    peerManifest: state.peerManifest,
    diff: compareSyncManifests(localManifest, state.peerManifest),
  };
  emitSafely(state.emit, {
    type: "peer-connected",
    connection: {
      ...connection,
      peerName: peerName ?? connection.peerName,
      peerIp: peerIp ?? connection.peerIp,
    },
  });
  emitSafely(state.emit, {
    type: "diff-updated",
    diff: connection.diff,
    summary: summarizeDiff(connection.diff),
  });
}

async function serveRequest(
  req: IncomingMessage,
  res: ServerResponse,
  state: HostState,
): Promise<void> {
  const url = parseRequestUrl(req);
  if (req.method === "GET" && url.pathname === "/manifest") {
    const localManifest = await createSyncManifest(state.instancePath);
    const info = getInstanceInfo(state.instancePath);
    respond(res, 200, {
      instanceName: info.instanceName || basename(state.instancePath),
      manifest: localManifest,
    });
    return;
  }
  if (req.method === "POST" && url.pathname === "/handshake") {
    try {
      const body = (await readJson(req, 32 * 1024 * 1024)) as {
        clientName?: unknown;
        manifest?: unknown;
      };
      if (typeof body.clientName !== "string" || !body.clientName.trim())
        throw new Error("Client name is required");
      const peerManifest = validateManifest(body.manifest);
      const peerIp = peerIpFromRequest(req);
      const localInfo = getInstanceInfo(state.instancePath);
      state.peerManifest = peerManifest;
      state.peerInfo = {
        name: body.clientName.trim().slice(0, 120),
        ip: peerIp,
        connectedAt: Date.now(),
      };
      await publishHostDiff(state);
      respond(res, 200, {
        hostName: localInfo.instanceName || basename(state.instancePath),
        success: true,
      });
    } catch (error) {
      respond(res, 400, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return;
  }
  if (req.method === "POST" && url.pathname === "/disconnect") {
    const remoteIp = peerIpFromRequest(req);
    if (state.peerInfo && state.peerInfo.ip === remoteIp) {
      state.peerInfo = null;
      state.peerManifest = null;
      emitSafely(state.emit, { type: "peer-disconnected" });
      const localManifest = await createSyncManifest(state.instancePath);
      const diff = compareSyncManifests(localManifest, []);
      emitSafely(state.emit, {
        type: "diff-updated",
        diff,
        summary: summarizeDiff(diff),
      });
    }
    respond(res, 200, { success: true });
    return;
  }
  if (req.method === "GET" && url.pathname.startsWith("/download/")) {
    const encodedName = url.pathname.slice("/download/".length);
    const fileName = safeFileName(decodeURIComponent(encodedName));
    const enabled = url.searchParams.get("enabled") !== "false";
    let filePath: string;
    try {
      filePath = locateModFile(state.instancePath, fileName, enabled);
    } catch {
      respond(res, 404, { error: "Mod archive was not found" });
      return;
    }
    const size = lstatSync(filePath).size;
    res.writeHead(200, {
      "content-type": "application/java-archive",
      "content-length": size,
      "x-file-name64": Buffer.from(fileName).toString("base64url"),
      "cache-control": "no-store",
    });
    res.socket?.setNoDelay(true);
    const stream = createReadStream(filePath, {
      highWaterMark: streamBufferBytes,
    });
    stream.on("error", () => {
      if (!res.headersSent)
        respond(res, 500, { error: "Could not read mod archive" });
      else res.destroy();
    });
    stream.pipe(res);
    return;
  }
  if (req.method === "POST" && url.pathname === "/upload") {
    req.socket.setNoDelay(true);
    try {
      const result = await receiveUpload(req, state.instancePath, (event) =>
        emitSafely(state.emit, event),
      );
      respond(res, 200, { success: true, ...result });
      emitSafely(state.emit, {
        type: "notification",
        action: "incoming-upload",
        fileName: result.fileName,
        modId: result.modId,
        message: `Received ${result.fileName} (${result.modId}) from your friend.`,
      });
    } catch (error) {
      respond(res, 400, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return;
  }
  if (req.method === "POST" && url.pathname === "/notify-action") {
    try {
      const body = (await readJson(req)) as {
        action?: unknown;
        fileName?: unknown;
        modId?: unknown;
      };
      if (
        body.action !== "delete-suggestion" ||
        typeof body.fileName !== "string" ||
        typeof body.modId !== "string"
      )
        throw new Error("Invalid action notification");
      const fileName = safeFileName(body.fileName);
      const modId = safeModId(body.modId);
      emitSafely(state.emit, {
        type: "notification",
        action: "delete-suggestion",
        fileName,
        modId,
        message: `Your friend suggests removing ${fileName} (${modId}).`,
      });
      respond(res, 202, { success: true });
    } catch (error) {
      respond(res, 400, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return;
  }
  respond(res, 404, { error: "Not found" });
}

function listen(server: Server, port: number, host: string): Promise<void> {
  return new Promise((resolveListen, reject) => {
    const onError = (error: NodeJS.ErrnoException): void => {
      server.removeListener("listening", onListening);
      reject(error);
    };
    const onListening = (): void => {
      server.removeListener("error", onError);
      resolveListen();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });
}

export async function startSyncHost(
  instancePath: string,
  preferredPort: number,
  emit: (event: SyncEvent | SyncHostEvent) => void,
): Promise<SyncHostInfo> {
  const root = validateInstanceRoot(instancePath);
  if (
    !Number.isInteger(preferredPort) ||
    preferredPort < 1024 ||
    preferredPort > 65535
  )
    throw new Error("Port must be between 1024 and 65535");
  if (activeHost) {
    if (activeHost.instancePath === root) return activeHost.info;
    throw new Error(
      "Stop hosting the current instance before starting another host",
    );
  }
  const info = getInstanceInfo(root);
  const hostInfo: SyncHostInfo = {
    ip: detectSyncIp(),
    port: preferredPort,
    instanceName: info.instanceName || basename(root),
  };
  let hostState: HostState | null = null;
  for (let attempt = 0; attempt <= 20; attempt += 1) {
    const port = preferredPort + attempt;
    if (port > 65535) break;
    const candidateState: HostState = {
      server: undefined as unknown as Server,
      instancePath: root,
      emit,
      info: { ...hostInfo, port },
      peerManifest: null,
      peerInfo: null,
    };
    const candidate = createServer((req, res) => {
      void serveRequest(req, res, candidateState).catch((error: unknown) => {
        if (!res.headersSent)
          respond(res, 500, {
            error: error instanceof Error ? error.message : String(error),
          });
        else res.destroy();
      });
    });
    candidateState.server = candidate;
    try {
      await listen(candidate, port, hostInfo.ip);
      hostState = candidateState;
      hostInfo.port = port;
      break;
    } catch (error) {
      candidate.close(() => undefined);
      if ((error as NodeJS.ErrnoException).code !== "EADDRINUSE") throw error;
    }
  }
  if (!hostState)
    throw new Error(
      "Could not find an open port from 48500 to 48520. Choose another port and retry.",
    );
  hostState.info = hostInfo;
  activeHost = hostState;
  return hostInfo;
}

export async function stopSyncHost(): Promise<void> {
  const host = activeHost;
  activeHost = null;
  if (!host) return;
  if (host.peerInfo) emitSafely(host.emit, { type: "peer-disconnected" });
  cancelAllSyncTransfers();
  host.server.closeAllConnections();
  await new Promise<void>((resolveClose) =>
    host.server.close(() => resolveClose()),
  );
}

export function cancelSyncTransfer(transferId: string): boolean {
  const cancel = activeTransfers.get(transferId);
  if (!cancel) return false;
  cancel();
  return true;
}

export function cancelAllSyncTransfers(): void {
  for (const cancel of activeTransfers.values()) cancel();
}

export async function clearHostedPeer(): Promise<void> {
  const host = activeHost;
  if (!host?.peerInfo) return;
  host.peerManifest = null;
  host.peerInfo = null;
  emitSafely(host.emit, { type: "peer-disconnected" });
  const localManifest = await createSyncManifest(host.instancePath);
  const diff = compareSyncManifests(localManifest, []);
  emitSafely(host.emit, {
    type: "diff-updated",
    diff,
    summary: summarizeDiff(diff),
  });
}

export async function disconnectSyncPeer(
  peerIp: string,
  peerPort: number,
): Promise<void> {
  validatePeer(peerIp, peerPort);
  const body = Buffer.alloc(0);
  try {
    await requestBuffer(
      peerIp,
      peerPort,
      "/disconnect",
      "POST",
      { "content-length": "0" },
      body,
      2_000,
    );
  } catch {
    // A peer may have already closed its server; local disconnect still completes.
  }
  if (activeHost?.peerInfo?.ip === peerIp) await clearHostedPeer();
}

function validatePeer(peerIp: string, peerPort: number): void {
  if (typeof peerIp !== "string" || isIP(peerIp) !== 4)
    throw new Error("Enter a valid IPv4 address");
  if (!Number.isInteger(peerPort) || peerPort < 1 || peerPort > 65535)
    throw new Error("Enter a valid port between 1 and 65535");
}

function requestBuffer(
  peerIp: string,
  peerPort: number,
  path: string,
  method = "GET",
  headers: Record<string, string> = {},
  body?: Buffer,
  timeoutMs = 30_000,
): Promise<{
  status: number;
  body: Buffer;
  headers: IncomingMessage["headers"];
}> {
  validatePeer(peerIp, peerPort);
  return new Promise((resolveResponse, reject) => {
    const request = httpRequest(
      {
        host: peerIp,
        port: peerPort,
        path,
        method,
        headers,
        timeout: timeoutMs,
      },
      (response) => {
        const chunks: Buffer[] = [];
        let size = 0;
        response.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > 32 * 1024 * 1024)
            request.destroy(new Error("Peer response is too large"));
          else chunks.push(chunk);
        });
        response.on("end", () =>
          resolveResponse({
            status: response.statusCode ?? 0,
            body: Buffer.concat(chunks),
            headers: response.headers,
          }),
        );
      },
    );
    request.once("error", reject);
    request.once("timeout", () =>
      request.destroy(new Error("Peer connection timed out")),
    );
    if (body) request.end(body);
    else request.end();
  });
}

function parsePeerManifest(payload: Buffer): {
  instanceName: string;
  manifest: SyncManifestEntry[];
} {
  const raw: unknown = JSON.parse(payload.toString("utf8"));
  if (
    typeof raw !== "object" ||
    raw === null ||
    !Array.isArray((raw as { manifest?: unknown }).manifest)
  )
    throw new Error("The peer returned an invalid mod manifest");
  const data = raw as { instanceName?: unknown; manifest: unknown[] };
  const manifest = data.manifest.filter((value): value is SyncManifestEntry => {
    if (typeof value !== "object" || value === null) return false;
    const entry = value as Partial<SyncManifestEntry>;
    return (
      typeof entry.fileName === "string" &&
      typeof entry.size === "number" &&
      typeof entry.sha1 === "string" &&
      /^[a-f0-9]{40}$/i.test(entry.sha1) &&
      typeof entry.modId === "string" &&
      typeof entry.version === "string" &&
      typeof entry.name === "string" &&
      typeof entry.enabled === "boolean"
    );
  });
  return {
    instanceName:
      typeof data.instanceName === "string"
        ? data.instanceName
        : "Friend's instance",
    manifest,
  };
}

export async function connectSyncPeer(
  instancePath: string,
  peerIp: string,
  peerPort: number,
): Promise<SyncConnection> {
  validatePeer(peerIp, peerPort);
  const startedAt = Date.now();
  const response = await requestBuffer(peerIp, peerPort, "/manifest");
  if (response.status !== 200)
    throw new Error(`Peer returned HTTP ${response.status}`);
  const peerData = parsePeerManifest(response.body);
  const localManifest = await createSyncManifest(instancePath);
  const info = getInstanceInfo(instancePath);
  const localName = info.instanceName || basename(instancePath);
  const handshakeBody = Buffer.from(
    JSON.stringify({ clientName: localName, manifest: localManifest }),
  );
  const handshake = await requestBuffer(
    peerIp,
    peerPort,
    "/handshake",
    "POST",
    {
      "content-type": "application/json",
      "content-length": String(handshakeBody.length),
    },
    handshakeBody,
  );
  if (handshake.status !== 200)
    throw new Error(`Peer rejected the handshake (HTTP ${handshake.status})`);
  let hostName = peerData.instanceName;
  try {
    const handshakeResponse = JSON.parse(handshake.body.toString("utf8")) as {
      hostName?: unknown;
    };
    if (typeof handshakeResponse.hostName === "string")
      hostName = handshakeResponse.hostName;
  } catch {
    /* Keep the name from the manifest response. */
  }
  return {
    peerIp,
    peerPort,
    peerName: hostName,
    localName,
    pingMs: Date.now() - startedAt,
    localManifest,
    peerManifest: peerData.manifest,
    diff: compareSyncManifests(localManifest, peerData.manifest),
  };
}

function findLocalEntry(
  instancePath: string,
  fileName: string,
  enabled: boolean,
): string {
  const root = validateInstanceRoot(instancePath);
  return locateModFile(root, fileName, enabled);
}

function transferTransform(
  direction: "push" | "pull",
  fileName: string,
  totalBytes: number,
  emit: (event: SyncEvent) => void,
  hash?: ReturnType<typeof createHash>,
): Transform {
  let bytesTransferred = 0;
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      bytesTransferred += chunk.length;
      hash?.update(chunk);
      emitSafely(emit, {
        type: "progress",
        direction,
        fileName,
        bytesTransferred,
        totalBytes,
        percent:
          totalBytes > 0
            ? Math.min(100, Math.round((bytesTransferred * 100) / totalBytes))
            : 0,
      });
      callback(null, chunk);
    },
  });
}

export async function pushSyncFile(
  instancePath: string,
  peerIp: string,
  peerPort: number,
  entry: SyncManifestEntry,
  replaceModId: string | undefined,
  emit: (event: SyncEvent) => void,
  transferId?: string,
): Promise<void> {
  validatePeer(peerIp, peerPort);
  const fileName = safeFileName(entry.fileName);
  const filePath = findLocalEntry(instancePath, fileName, entry.enabled);
  if ((await sha1File(filePath)) !== entry.sha1)
    throw new Error(
      `${fileName} changed since the last comparison. Reconnect and try again.`,
    );
  const headers: Record<string, string> = {
    "content-type": "application/octet-stream",
    "content-length": String(entry.size),
    "x-file-name64": Buffer.from(fileName).toString("base64url"),
    "x-file-sha1": entry.sha1,
    "x-mod-id": safeModId(entry.modId),
    "x-mod-version": encodeURIComponent(entry.version),
    "x-enabled": String(entry.enabled),
  };
  if (replaceModId) headers["x-replace-mod-id"] = safeModId(replaceModId);
  const id = transferId ?? randomUUID();
  if (activeTransfers.has(id))
    throw new Error("A transfer with this ID is already active");
  const controller = new AbortController();
  let request: ClientRequest | null = null;
  activeTransfers.set(id, () => {
    controller.abort();
    request?.destroy(new Error("Transfer canceled"));
  });
  request = httpRequest({
    host: peerIp,
    port: peerPort,
    path: "/upload",
    method: "POST",
    headers,
    timeout: 120_000,
  });
  const responsePromise = new Promise<{ status: number; body: Buffer }>(
    (resolveResponse, reject) => {
      request.once("response", (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () =>
          resolveResponse({
            status: response.statusCode ?? 0,
            body: Buffer.concat(chunks),
          }),
        );
      });
      request.once("error", reject);
      request.once("timeout", () =>
        request.destroy(new Error("Transfer timed out")),
      );
    },
  );
  try {
    void responsePromise.catch(() => undefined);
    await pipeline(
      createReadStream(filePath, { highWaterMark: streamBufferBytes }),
      transferTransform("push", fileName, entry.size, emit),
      request,
      { signal: controller.signal },
    );
    const response = await responsePromise;
    if (response.status !== 200) {
      let message = `Peer rejected ${fileName} (HTTP ${response.status})`;
      try {
        message =
          (JSON.parse(response.body.toString("utf8")) as { error?: string })
            .error ?? message;
      } catch {
        /* Use default. */
      }
      throw new Error(message);
    }
  } finally {
    activeTransfers.delete(id);
  }
}

async function downloadToStage(
  root: string,
  peerIp: string,
  peerPort: number,
  entry: SyncManifestEntry,
  emit: (event: SyncEvent) => void,
  signal: AbortSignal,
): Promise<string> {
  const fileName = safeFileName(entry.fileName);
  if (
    !Number.isSafeInteger(entry.size) ||
    entry.size < 0 ||
    entry.size > MAX_FILE_SIZE
  ) {
    throw new Error(
      "Peer manifest contains an invalid or oversized mod archive",
    );
  }
  const path = `/download/${encodeURIComponent(fileName)}?enabled=${entry.enabled ? "true" : "false"}`;
  const staging = join(root, MODS_DIR, STAGING_DIR);
  await mkdir(staging, { recursive: true });
  const temporaryPath = join(staging, `${fileName}.${randomUUID()}.tmp`);
  const hash = createHash("sha1");
  await new Promise<void>((resolveDownload, reject) => {
    const request = httpGet(
      { host: peerIp, port: peerPort, path, timeout: 120_000 },
      (response) => {
        if (response.statusCode !== 200) {
          response.resume();
          reject(
            new Error(
              `Peer could not send ${fileName} (HTTP ${response.statusCode ?? 0})`,
            ),
          );
          return;
        }
        const totalBytes = Number(
          response.headers["content-length"] ?? entry.size,
        );
        if (
          !Number.isSafeInteger(totalBytes) ||
          totalBytes !== entry.size ||
          totalBytes > MAX_FILE_SIZE
        ) {
          response.destroy(new Error("Peer sent an unexpected file size"));
          reject(new Error("Peer sent an unexpected file size"));
          return;
        }
        const transform = transferTransform(
          "pull",
          fileName,
          totalBytes,
          emit,
          hash,
        );
        pipeline(
          response,
          transform,
          createWriteStream(temporaryPath, {
            flags: "wx",
            highWaterMark: streamBufferBytes,
          }),
          { signal },
        )
          .then(resolveDownload)
          .catch(reject);
      },
    );
    const onAbort = (): void => {
      request.destroy(new Error("Transfer canceled"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    request.once("close", () => signal.removeEventListener("abort", onAbort));
    request.once("error", reject);
    request.once("timeout", () =>
      request.destroy(new Error("Download timed out")),
    );
  }).catch(async (error: unknown) => {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  });
  if (hash.digest("hex") !== entry.sha1) {
    await rm(temporaryPath, { force: true });
    throw new Error(`${fileName} failed SHA-1 verification and was discarded`);
  }
  return temporaryPath;
}

export async function pullSyncFile(
  instancePath: string,
  peerIp: string,
  peerPort: number,
  entry: SyncManifestEntry,
  replaceModId: string | undefined,
  emit: (event: SyncEvent) => void,
  transferId?: string,
): Promise<void> {
  validatePeer(peerIp, peerPort);
  const root = validateInstanceRoot(instancePath);
  const id = transferId ?? randomUUID();
  if (activeTransfers.has(id))
    throw new Error("A transfer with this ID is already active");
  const controller = new AbortController();
  activeTransfers.set(id, () => controller.abort());
  let temporaryPath: string | null = null;
  try {
    temporaryPath = await downloadToStage(
      root,
      peerIp,
      peerPort,
      entry,
      emit,
      controller.signal,
    );
    if (controller.signal.aborted) throw new Error("Transfer canceled");
    moveExistingMods(root, replaceModId ?? "", entry.fileName);
    const directory = entry.enabled ? MODS_DIR : DISABLED_DIR;
    await mkdir(join(root, directory), { recursive: true });
    await rename(
      temporaryPath,
      join(root, directory, safeFileName(entry.fileName)),
    );
  } catch (error) {
    if (temporaryPath)
      await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  } finally {
    activeTransfers.delete(id);
  }
}

export async function suggestPeerDelete(
  peerIp: string,
  peerPort: number,
  entry: SyncManifestEntry,
): Promise<void> {
  const body = Buffer.from(
    JSON.stringify({
      action: "delete-suggestion",
      fileName: safeFileName(entry.fileName),
      modId: safeModId(entry.modId),
    }),
  );
  const response = await requestBuffer(
    peerIp,
    peerPort,
    "/notify-action",
    "POST",
    {
      "content-type": "application/json",
      "content-length": String(body.length),
    },
    body,
  );
  if (response.status !== 202)
    throw new Error(
      `Peer could not receive the suggestion (HTTP ${response.status})`,
    );
}
