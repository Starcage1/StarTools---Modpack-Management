import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
} from "react";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  LoaderCircle,
  RefreshCw,
  Search,
  Trash2,
} from "lucide-react";
import type {
  SyncConnection,
  SyncDiffEntry,
  SyncDiffType,
  SyncEvent,
  SyncHostInfo,
  SyncManifestEntry,
} from "../../../shared/types";
import { useDebounce } from "../hooks/useDebounce";

interface SyncTabProps {
  instancePath: string | null;
  defaultPort: number;
  searchDebounceMs: number;
  onNotify: (message: string) => void;
  onError: (message: string | null) => void;
}

type Filter = "all" | SyncDiffType;

function currentTimestamp(): number {
  return Date.now();
}

interface ActiveQueue {
  id: string;
  direction: "push" | "pull";
  index: number;
  total: number;
  fileName: string;
}

const stateLabels: Record<SyncDiffType, string> = {
  only_local: "Only on You",
  only_peer: "Only on Friend",
  version_mismatch: "Version Mismatch",
  synced: "In Sync",
};

const stateClasses: Record<SyncDiffType, string> = {
  only_local: "border-amber-500/30 bg-amber-500/10 text-amber-300",
  only_peer: "border-cyan-500/30 bg-cyan-500/10 text-cyan-300",
  version_mismatch: "border-purple-500/30 bg-purple-500/10 text-purple-300",
  synced: "border-emerald-500/25 bg-emerald-500/10 text-emerald-300",
};

function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(
    units.length - 1,
    Math.floor(Math.log(bytes) / Math.log(1024)),
  );
  return `${(bytes / 1024 ** index).toFixed(index >= 2 ? 1 : 0)} ${units[index]}`;
}

function parsePeerAddress(
  value: string,
  defaultPort = 48500,
): { ip: string; port: number } {
  const trimmed = value.trim();
  const match = /^(\d{1,3}(?:\.\d{1,3}){3})(?::(\d{1,5}))?$/.exec(trimmed);
  if (!match)
    throw new Error(
      "Enter your friend's IPv4 address, with an optional :port.",
    );
  const port = Number(match[2] ?? defaultPort);
  if (
    port < 1 ||
    port > 65535 ||
    match[1].split(".").some((part) => Number(part) > 255)
  ) {
    throw new Error("That IP address or port is invalid.");
  }
  return { ip: match[1], port };
}

export default function SyncTab({
  instancePath,
  defaultPort,
  searchDebounceMs,
  onNotify,
  onError,
}: SyncTabProps): JSX.Element {
  const [host, setHost] = useState<SyncHostInfo | null>(null);
  const [customPort, setCustomPort] = useState<string | null>(null);
  const port = customPort ?? String(defaultPort);
  const [peerAddress, setPeerAddress] = useState("");
  const [connection, setConnection] = useState<SyncConnection | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [pageSize, setPageSize] = useState(50);
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const [activeQueue, setActiveQueue] = useState<ActiveQueue | null>(null);
  const [transfer, setTransfer] = useState<Extract<
    SyncEvent,
    { type: "progress" }
  > | null>(null);
  const [transferSpeed, setTransferSpeed] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const transferStartedAt = useRef(0);
  const canceledQueues = useRef(new Set<string>());
  const debouncedQuery = useDebounce(query, searchDebounceMs);

  const connect = useCallback(
    async (ip: string, targetPort: number) => {
      if (!instancePath)
        throw new Error("Select an instance before connecting.");
      const result = await window.api.connectSyncPeer(
        instancePath,
        ip,
        targetPort,
      );
      setConnection(result);
      setPeerAddress(`${ip}:${targetPort}`);
      return result;
    },
    [instancePath],
  );

  useEffect(
    () =>
      window.api.onSyncEvent((event) => {
        if (event.type === "progress") {
          if (
            event.bytesTransferred <= 1 ||
            event.percent === 0 ||
            !transferStartedAt.current
          )
            transferStartedAt.current = currentTimestamp();
          const elapsed = Math.max(
            0.1,
            (currentTimestamp() - transferStartedAt.current) / 1000,
          );
          setTransferSpeed(event.bytesTransferred / elapsed / 1024 / 1024);
          setTransfer(event);
        } else {
          setNotice(event.message);
          onNotify(event.message);
          if (event.action === "incoming-upload" && connection && !host) {
            void connect(connection.peerIp, connection.peerPort).catch(
              () => undefined,
            );
          }
        }
      }),
    [connect, connection, host, onNotify],
  );

  useEffect(() => {
    const unsubscribeConnected = window.api.onSyncPeerConnected(
      (peerConnection) => {
        setConnection(peerConnection);
        setFilter("all");
        setPage(1);
      },
    );
    const unsubscribeDiff = window.api.onSyncDiffUpdated(({ diff }) => {
      setConnection((current) => (current ? { ...current, diff } : current));
    });
    const unsubscribeDisconnected = window.api.onSyncPeerDisconnected(() => {
      setConnection(null);
      setActiveQueue(null);
      setTransfer(null);
    });
    return () => {
      unsubscribeConnected();
      unsubscribeDiff();
      unsubscribeDisconnected();
    };
  }, []);

  useEffect(
    () => () => {
      void window.api.stopSyncHost().catch(() => undefined);
    },
    [],
  );

  const counts = useMemo(
    () => ({
      all: connection?.diff.length ?? 0,
      only_local:
        connection?.diff.filter((item) => item.type === "only_local").length ??
        0,
      only_peer:
        connection?.diff.filter((item) => item.type === "only_peer").length ??
        0,
      version_mismatch:
        connection?.diff.filter((item) => item.type === "version_mismatch")
          .length ?? 0,
      synced:
        connection?.diff.filter((item) => item.type === "synced").length ?? 0,
    }),
    [connection],
  );
  const filteredDiff = useMemo(() => {
    const normalized = debouncedQuery.trim().toLocaleLowerCase();
    return (connection?.diff ?? []).filter((item) => {
      if (filter !== "all" && item.type !== filter) return false;
      if (!normalized) return true;
      const entry = item.local ?? item.peer;
      return `${entry?.name ?? ""} ${entry?.fileName ?? ""} ${item.local?.fileName ?? ""} ${item.peer?.fileName ?? ""}`
        .toLocaleLowerCase()
        .includes(normalized);
    });
  }, [connection, filter, debouncedQuery]);
  const totalPages = Math.max(1, Math.ceil(filteredDiff.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const visibleDiff = filteredDiff.slice(
    (safePage - 1) * pageSize,
    safePage * pageSize,
  );

  const doHost = async (): Promise<void> => {
    if (!instancePath) return;
    setBusy(true);
    onError(null);
    try {
      const result = await window.api.startSyncHost(instancePath, Number(port));
      setHost(result);
      onNotify(`Hosting ${result.instanceName} at ${result.ip}:${result.port}`);
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const stopHosting = async (): Promise<void> => {
    setBusy(true);
    try {
      await window.api.stopSyncHost();
      setHost(null);
      setConnection(null);
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const doConnect = async (): Promise<void> => {
    setBusy(true);
    onError(null);
    try {
      const peer = parsePeerAddress(peerAddress, defaultPort);
      await connect(peer.ip, peer.port);
      setFilter("all");
      onNotify(
        "Connected. Review the mod differences before transferring files.",
      );
    } catch (error) {
      setConnection(null);
      onError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const refresh = async (): Promise<SyncConnection | null> => {
    if (!connection) return null;
    const updated = await connect(connection.peerIp, connection.peerPort);
    return updated;
  };

  const runTransfer = async (
    direction: "push" | "pull",
    entry: SyncManifestEntry,
    replaceModId?: string,
  ): Promise<void> => {
    if (!instancePath || !connection) return;
    const transferId = crypto.randomUUID();
    setBusy(true);
    onError(null);
    setActiveQueue({
      id: transferId,
      direction,
      index: 1,
      total: 1,
      fileName: entry.fileName,
    });
    setTransfer(null);
    setTransferSpeed(0);
    transferStartedAt.current = currentTimestamp();
    try {
      if (direction === "push")
        await window.api.pushSyncFile(
          instancePath,
          connection.peerIp,
          connection.peerPort,
          entry,
          replaceModId,
          transferId,
        );
      else
        await window.api.pullSyncFile(
          instancePath,
          connection.peerIp,
          connection.peerPort,
          entry,
          replaceModId,
          transferId,
        );
      setTransfer(null);
      await refresh();
      onNotify(
        `${direction === "push" ? "Sent" : "Received"} ${entry.fileName}.`,
      );
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    } finally {
      setActiveQueue(null);
      setBusy(false);
    }
  };

  const deleteLocal = async (entry: SyncManifestEntry): Promise<void> => {
    if (
      !instancePath ||
      !window.confirm(`Move ${entry.fileName} to StarTools' restorable trash?`)
    )
      return;
    setBusy(true);
    onError(null);
    try {
      await window.api.trashMod(instancePath, entry.fileName, entry.modId);
      await refresh();
      onNotify(`${entry.fileName} moved to restorable trash.`);
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const suggestDelete = async (entry: SyncManifestEntry): Promise<void> => {
    if (!connection) return;
    setBusy(true);
    onError(null);
    try {
      await window.api.suggestSyncDelete(
        connection.peerIp,
        connection.peerPort,
        entry,
      );
      onNotify(`Delete suggestion sent for ${entry.fileName}.`);
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const runBulk = async (direction: "push" | "pull"): Promise<void> => {
    if (!connection) return;
    const transferId = crypto.randomUUID();
    const work = connection.diff
      .filter(
        (item) =>
          item.type === (direction === "push" ? "only_local" : "only_peer"),
      )
      .map((item) => (direction === "push" ? item.local : item.peer))
      .filter((item): item is SyncManifestEntry => Boolean(item));
    if (!work.length) return;
    setBusy(true);
    onError(null);
    setTransfer(null);
    setTransferSpeed(0);
    transferStartedAt.current = currentTimestamp();
    try {
      for (const [index, entry] of work.entries()) {
        if (canceledQueues.current.has(transferId)) break;
        transferStartedAt.current = currentTimestamp();
        setTransferSpeed(0);
        setTransfer(null);
        setActiveQueue({
          id: transferId,
          direction,
          index: index + 1,
          total: work.length,
          fileName: entry.fileName,
        });
        if (direction === "push")
          await window.api.pushSyncFile(
            instancePath!,
            connection.peerIp,
            connection.peerPort,
            entry,
            undefined,
            transferId,
          );
        else
          await window.api.pullSyncFile(
            instancePath!,
            connection.peerIp,
            connection.peerPort,
            entry,
            undefined,
            transferId,
          );
        if (canceledQueues.current.has(transferId)) break;
        await connect(connection.peerIp, connection.peerPort);
      }
      setTransfer(null);
      if (canceledQueues.current.has(transferId))
        onNotify("Transfer queue canceled. Completed files were kept.");
      else
        onNotify(
          `${direction === "push" ? "Pushed" : "Pulled"} ${work.length} mod(s).`,
        );
    } catch (error) {
      if (canceledQueues.current.has(transferId))
        onNotify("Transfer queue canceled. Completed files were kept.");
      else onError(error instanceof Error ? error.message : String(error));
    } finally {
      canceledQueues.current.delete(transferId);
      setActiveQueue(null);
      setBusy(false);
    }
  };

  const cancelAll = async (): Promise<void> => {
    const current = activeQueue;
    if (!current) return;
    canceledQueues.current.add(current.id);
    await window.api.cancelSyncTransfer(current.id);
  };

  const disconnect = async (): Promise<void> => {
    setBusy(true);
    onError(null);
    if (activeQueue) canceledQueues.current.add(activeQueue.id);
    await window.api.cancelAllSyncTransfers();
    try {
      if (host) await window.api.disconnectHostedPeer();
      else if (connection)
        await window.api.disconnectSyncPeer(
          connection.peerIp,
          connection.peerPort,
        );
      setConnection(null);
      setActiveQueue(null);
      setTransfer(null);
      onNotify("Disconnected from peer.");
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const renderActions = (item: SyncDiffEntry): JSX.Element => {
    const entry = item.local ?? item.peer;
    const currentTransfer = Boolean(
      entry && activeQueue?.fileName === entry.fileName,
    );
    if (item.type === "synced")
      return (
        <span className="inline-flex items-center gap-1 text-xs text-emerald-300">
          <Check size={14} /> Synced
        </span>
      );
    if (item.type === "only_local" && item.local)
      return (
        <div className="flex items-center gap-2">
          <button
            disabled={busy}
            onClick={() => void runTransfer("push", item.local!)}
            className="sync-action"
          >
            {currentTransfer && activeQueue?.direction === "push" ? (
              <LoaderCircle size={13} className="animate-spin" />
            ) : (
              <ArrowUpFromLine size={13} />
            )}
            {currentTransfer && activeQueue?.direction === "push"
              ? "Pushing..."
              : "Push"}
          </button>
          <button
            disabled={busy}
            onClick={() => void deleteLocal(item.local!)}
            className="sync-action sync-danger"
          >
            <Trash2 size={13} /> Delete
          </button>
        </div>
      );
    if (item.type === "only_peer" && item.peer)
      return (
        <div className="flex items-center gap-2">
          <button
            disabled={busy}
            onClick={() => void runTransfer("pull", item.peer!)}
            className="sync-action"
          >
            {currentTransfer && activeQueue?.direction === "pull" ? (
              <LoaderCircle size={13} className="animate-spin" />
            ) : (
              <ArrowDownToLine size={13} />
            )}
            {currentTransfer && activeQueue?.direction === "pull"
              ? "Pulling..."
              : "Pull"}
          </button>
          <button
            disabled={busy}
            onClick={() => void suggestDelete(item.peer!)}
            className="sync-action"
          >
            Suggest Delete
          </button>
        </div>
      );
    if (item.type === "version_mismatch" && item.local && item.peer)
      return (
        <div className="flex items-center gap-2">
          <button
            disabled={busy}
            onClick={() =>
              void runTransfer("push", item.local!, item.peer!.modId)
            }
            className="sync-action"
          >
            {currentTransfer && activeQueue?.direction === "push" ? (
              <LoaderCircle size={13} className="animate-spin" />
            ) : (
              <ArrowUpFromLine size={13} />
            )}
            {currentTransfer && activeQueue?.direction === "push"
              ? "Pushing..."
              : "Overwrite Friend"}
          </button>
          <button
            disabled={busy}
            onClick={() =>
              void runTransfer("pull", item.peer!, item.local!.modId)
            }
            className="sync-action"
          >
            {currentTransfer && activeQueue?.direction === "pull" ? (
              <LoaderCircle size={13} className="animate-spin" />
            ) : (
              <ArrowDownToLine size={13} />
            )}
            {currentTransfer && activeQueue?.direction === "pull"
              ? "Pulling..."
              : "Accept Friend&apos;s"}
          </button>
        </div>
      );
    return <span className="text-xs text-zinc-500">—</span>;
  };

  return (
    <section className="sync-view" aria-label="Modpack sync">
      {(host || connection) && (
        <div className="sync-role-header">
          <div className="sync-role-copy">
            <strong>{host ? "Host Mode" : "Client Mode"}</strong>
            <span>
              {host
                ? `Hosting on ${host.ip}:${host.port}`
                : `Connected to ${connection?.peerIp}:${connection?.peerPort}`}
              {host && connection
                ? ` · Peer ${connection.peerName} (${connection.peerIp})`
                : ""}
            </span>
          </div>
          {connection && (
            <button
              className="sync-disconnect"
              disabled={busy}
              onClick={() => void disconnect()}
            >
              Disconnect
            </button>
          )}
        </div>
      )}
      <div className="sync-connect-card">
        <div className="sync-card-section">
          <div className="sync-section-heading">
            <div>
              <h2>Host this instance</h2>
              <p>
                Share your modlist directly over Radmin VPN or your local
                network.
              </p>
            </div>
            <span className={`sync-status ${host ? "sync-online" : ""}`}>
              {host ? "Hosting" : "Not hosting"}
            </span>
          </div>
          {host ? (
            <div className="sync-host-address">
              <code>
                {host.ip}:{host.port}
              </code>
              <button
                className="sync-secondary"
                onClick={() =>
                  void window.api
                    .copyText(`${host.ip}:${host.port}`)
                    .then(() => onNotify("Host address copied."))
                }
              >
                <Copy size={14} /> Copy IP
              </button>
              <button
                className="sync-secondary"
                disabled={busy}
                onClick={() => void stopHosting()}
              >
                Stop hosting
              </button>
            </div>
          ) : (
            <div className="sync-form-row">
              <label className="sr-only" htmlFor="sync-host-port">
                Host port
              </label>
              <input
                id="sync-host-port"
                type="number"
                min={1024}
                max={65535}
                value={port}
                onChange={(event) => setCustomPort(event.target.value)}
                className="sync-input sync-port"
              />
              <button
                disabled={!instancePath || busy}
                className="sync-primary"
                onClick={() => void doHost()}
              >
                {busy ? (
                  <LoaderCircle className="animate-spin" size={15} />
                ) : null}{" "}
                Start Hosting
              </button>
            </div>
          )}
        </div>
        <div className="sync-card-section">
          <div className="sync-section-heading">
            <div>
              <h2>Join a friend</h2>
              <p>Enter the IPv4 address and port shown on their Sync screen.</p>
            </div>
            <span className={`sync-status ${connection ? "sync-online" : ""}`}>
              {connection
                ? `${connection.peerName} · ${connection.pingMs} ms`
                : "Disconnected"}
            </span>
          </div>
          <div className="sync-form-row">
            <label className="sr-only" htmlFor="sync-peer-address">
              Friend&apos;s Radmin IP and port
            </label>
            <input
              id="sync-peer-address"
              value={peerAddress}
              onChange={(event) => setPeerAddress(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void doConnect();
              }}
              placeholder="26.12.34.56:48500"
              className="sync-input"
            />
            <button
              disabled={!instancePath || busy || !peerAddress.trim()}
              className="sync-primary"
              onClick={() => void doConnect()}
            >
              {busy ? (
                <LoaderCircle className="animate-spin" size={15} />
              ) : (
                <RefreshCw size={15} />
              )}{" "}
              Connect
            </button>
            {connection && (
              <button
                disabled={busy}
                className="sync-secondary"
                onClick={() => void doConnect()}
              >
                Refresh
              </button>
            )}
          </div>
        </div>
      </div>

      {notice && (
        <div className="sync-notice" role="status">
          {notice}
          <button onClick={() => setNotice(null)} aria-label="Dismiss notice">
            ×
          </button>
        </div>
      )}

      {connection ? (
        <>
          <div className="sync-summary" aria-label="Filter mod differences">
            {(
              [
                "all",
                "only_local",
                "only_peer",
                "version_mismatch",
                "synced",
              ] as const
            ).map((type) => (
              <button
                key={type}
                aria-pressed={filter === type}
                onClick={() => {
                  setFilter(type);
                  setPage(1);
                }}
                className={`sync-summary-chip ${filter === type ? "sync-summary-active" : ""}`}
              >
                <span>
                  {type === "all"
                    ? "All"
                    : type === "only_local"
                      ? "Missing on Friend"
                      : type === "only_peer"
                        ? "Missing on Me"
                        : type === "version_mismatch"
                          ? "Version Mismatch"
                          : "In Sync"}
                </span>
                <strong>{counts[type]}</strong>
              </button>
            ))}
          </div>
          <div className="sync-table-toolbar">
            <label className="sync-search-wrap">
              <Search size={14} />
              <input
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setPage(1);
                }}
                placeholder="Search mods or filenames..."
                autoComplete="off"
                aria-label="Search mods or filenames"
              />
            </label>
            <select
              aria-label="Rows per page"
              value={pageSize}
              onChange={(event) => {
                setPageSize(Number(event.target.value));
                setPage(1);
              }}
            >
              {[25, 50, 100].map((size) => (
                <option key={size} value={size}>
                  {size} / page
                </option>
              ))}
            </select>
            <div className="sync-pagination">
              <span>
                Page {safePage} of {totalPages}
              </span>
              <button
                disabled={safePage <= 1}
                onClick={() => setPage((value) => Math.max(1, value - 1))}
                aria-label="Previous page"
              >
                <ChevronLeft size={14} />
              </button>
              <button
                disabled={safePage >= totalPages}
                onClick={() =>
                  setPage((value) => Math.min(totalPages, value + 1))
                }
                aria-label="Next page"
              >
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
          <div className="sync-table-wrap">
            <table className="sync-table">
              <thead>
                <tr>
                  <th>Mod / File Name</th>
                  <th>State</th>
                  <th>File Size</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {visibleDiff.map((item) => {
                  const entry = item.local ?? item.peer;
                  return (
                    <tr key={`${item.type}:${item.key}`}>
                      <td>
                        <div className="sync-mod-title">
                          {entry?.name ?? entry?.fileName}
                        </div>
                        <code>{entry?.fileName}</code>
                        {entry && !entry.enabled && (
                          <span className="sync-disabled-tag">Disabled</span>
                        )}
                      </td>
                      <td>
                        <span
                          className={`sync-state-badge ${stateClasses[item.type]}`}
                        >
                          {stateLabels[item.type]}
                        </span>
                      </td>
                      <td className="sync-size">
                        {formatBytes(
                          Math.max(item.local?.size ?? 0, item.peer?.size ?? 0),
                        )}
                      </td>
                      <td>{renderActions(item)}</td>
                    </tr>
                  );
                })}
                {!visibleDiff.length && (
                  <tr>
                    <td colSpan={4} className="sync-empty">
                      {query.trim()
                        ? `No mods match “${query.trim()}”.`
                        : filter === "all"
                          ? "No mods found in either instance."
                          : `No mods in “${stateLabels[filter]}”.`}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="sync-bottom-bar">
            <div className="sync-bulk-actions">
              <button
                className="sync-secondary"
                disabled={busy || counts.only_local === 0}
                onClick={() => void runBulk("push")}
              >
                <ArrowUpFromLine size={14} /> Push All Missing to Friend
              </button>
              <button
                className="sync-secondary"
                disabled={busy || counts.only_peer === 0}
                onClick={() => void runBulk("pull")}
              >
                <ArrowDownToLine size={14} /> Pull All Missing to Me
              </button>
            </div>
            <span className="sync-safety-copy">
              Transfers start only when you choose an action. Local deletes go
              to restorable trash.
            </span>
            {activeQueue && activeQueue.total > 1 && (
              <button
                className="sync-disconnect"
                disabled={!busy}
                onClick={() => void cancelAll()}
              >
                Cancel All
              </button>
            )}
          </div>
          {transfer && (
            <div className="sync-transfer">
              <div className="sync-transfer-label">
                <span>
                  {activeQueue && activeQueue.total > 1
                    ? `Transferring file (${activeQueue.index} of ${activeQueue.total}): ${activeQueue.fileName}`
                    : `${
                        transfer.direction === "push"
                          ? "Sending"
                          : transfer.direction === "pull"
                            ? "Receiving"
                            : "Incoming"
                      }: ${transfer.fileName}`}
                </span>
                <span>
                  {transfer.percent}% · {transferSpeed.toFixed(1)} MB/s
                </span>
              </div>
              <div className="sync-progress-track">
                <div style={{ width: `${transfer.percent}%` }} />
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="sync-empty-state">
          <div className="sync-empty-icon">
            <RefreshCw size={22} />
          </div>
          <h2>Connect to compare modlists</h2>
          <p>
            Once connected, you&apos;ll see matching mods, missing files, and
            version differences. Nothing transfers until you choose an action.
          </p>
        </div>
      )}
    </section>
  );
}
