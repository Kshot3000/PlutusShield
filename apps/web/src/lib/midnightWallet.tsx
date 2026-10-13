"use client";

/**
 * Lace Midnight DApp Connector for the static site.
 *
 * Discover + connect on Preprod via PlutusShield-owned helpers in
 * `@plutusshield/sdk/lace` (DApp Connector API 4.0.1). Circuit submit helpers
 * live in `@plutusshield/sdk/laceCircuits` and `/claim/evidence` (File with Lace).
 * Compact prove comes from the local holder prove bridge (`pnpm midnight:prove-bridge`);
 * Lace balances and submits. The claim kit remains the production filer until the
 * first finalized File-with-Lace bridge-drill submit on Preprod.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  LACE_MIDNIGHT_INSTALL_URL,
  PLUTUSSHIELD_MIDNIGHT_NETWORK,
  connectWithProvider,
  discoverProvidersFromMap,
  formatMidnightAddress,
  isLaceMidnightError,
  safeIconUrl,
  safeWalletLabel,
  userHintForError,
  type ConnectedSession,
  type DiscoveredProvider,
  type ServiceUriSummary,
} from "@plutusshield/sdk/lace";

export { LACE_MIDNIGHT_INSTALL_URL, formatMidnightAddress };

export type MidnightWalletStatus = "idle" | "connecting" | "connected" | "error";

export type MidnightWalletInfo = {
  injectionKey: string;
  name: string;
  icon?: string;
  rdns: string;
  apiVersion: string;
};

export type MidnightWalletState = {
  status: MidnightWalletStatus;
  providers: MidnightWalletInfo[];
  /** true once we've given injected wallets time to appear */
  detected: boolean;
  wallet?: MidnightWalletInfo;
  networkId?: string;
  unshieldedAddress?: string | null;
  shieldedAddress?: string | null;
  dustAddress?: string | null;
  services?: ServiceUriSummary;
  error?: string;
  updatedAt?: number;
  connect(injectionKey?: string): Promise<void>;
  disconnect(): void;
  refresh(): Promise<void>;
  /** Connected session API for follow-up circuit work (null when disconnected). */
  sessionApi(): ConnectedSession["api"] | null;
};

const STORAGE_KEY = "plutusshield.midnightWallet";
const MidnightWalletContext = createContext<MidnightWalletState | null>(null);

function midnightRoot(): Record<string, unknown> | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as Window & { midnight?: Record<string, unknown> }).midnight;
}

function toInfo(p: DiscoveredProvider): MidnightWalletInfo {
  return {
    injectionKey: p.injectionKey,
    name: safeWalletLabel(p.api),
    icon: safeIconUrl(p.api) ?? undefined,
    rdns: p.api.rdns,
    apiVersion: p.api.apiVersion,
  };
}

function scanProviders(): { infos: MidnightWalletInfo[]; providers: DiscoveredProvider[] } {
  const discovery = discoverProvidersFromMap(midnightRoot());
  return {
    infos: discovery.compatible.map(toInfo),
    providers: discovery.compatible,
  };
}

function describeError(e: unknown): string {
  if (isLaceMidnightError(e)) return userHintForError(e);
  return e instanceof Error ? e.message : "The Midnight wallet didn't respond.";
}

export function MidnightWalletProvider({ children }: { children: ReactNode }) {
  const [providers, setProviders] = useState<MidnightWalletInfo[]>([]);
  const [detected, setDetected] = useState(false);
  const [status, setStatus] = useState<MidnightWalletStatus>("idle");
  const [wallet, setWallet] = useState<MidnightWalletInfo>();
  const [networkId, setNetworkId] = useState<string>();
  const [unshieldedAddress, setUnshielded] = useState<string | null>();
  const [shieldedAddress, setShielded] = useState<string | null>();
  const [dustAddress, setDust] = useState<string | null>();
  const [services, setServices] = useState<ServiceUriSummary>();
  const [error, setError] = useState<string>();
  const [updatedAt, setUpdatedAt] = useState<number>();
  const session = useRef<ConnectedSession | null>(null);
  const providerCache = useRef<DiscoveredProvider[]>([]);

  const reset = useCallback(() => {
    session.current = null;
    setWallet(undefined);
    setNetworkId(undefined);
    setUnshielded(undefined);
    setShielded(undefined);
    setDust(undefined);
    setServices(undefined);
    setUpdatedAt(undefined);
  }, []);

  const applySession = useCallback((s: ConnectedSession) => {
    session.current = s;
    setWallet(toInfo(s.provider));
    setNetworkId(s.networkId);
    setUnshielded(s.addresses.unshieldedAddress);
    setShielded(s.addresses.shieldedAddress);
    setDust(s.addresses.dustAddress);
    setServices(s.services);
    setUpdatedAt(Date.now());
  }, []);

  const connectTo = useCallback(
    async (injectionKey: string | undefined, silent: boolean) => {
      const scanned = scanProviders();
      providerCache.current = scanned.providers;
      setProviders(scanned.infos);

      let provider: DiscoveredProvider | undefined;
      if (injectionKey) {
        provider = scanned.providers.find((p) => p.injectionKey === injectionKey);
      } else if (scanned.providers.length === 1) {
        provider = scanned.providers[0];
      } else if (scanned.providers.length > 1 && !silent) {
        setStatus("error");
        setError("Multiple Midnight wallets found. Pick one below.");
        return;
      }

      if (!provider) {
        if (!silent) {
          setStatus("error");
          setError(
            scanned.providers.length === 0
              ? "No Midnight wallet found. Install Lace with Midnight enabled, then refresh."
              : "That Midnight wallet isn't available in this browser.",
          );
        }
        return;
      }

      if (!silent) {
        setStatus("connecting");
        setError(undefined);
      } else {
        setStatus((prev) => (prev === "connected" ? prev : "connecting"));
      }

      try {
        const s = await connectWithProvider(provider, {
          networkId: PLUTUSSHIELD_MIDNIGHT_NETWORK,
          assertNetworkMatch: true,
        });
        applySession(s);
        setStatus("connected");
        setError(undefined);
        localStorage.setItem(STORAGE_KEY, provider.injectionKey);
      } catch (e) {
        reset();
        setStatus(silent ? "idle" : "error");
        if (!silent) setError(describeError(e));
        if (silent) localStorage.removeItem(STORAGE_KEY);
      }
    },
    [applySession, reset],
  );

  const refresh = useCallback(async () => {
    if (!session.current) return;
    try {
      const api = session.current.api;
      const statusNow = await api.getConnectionStatus();
      if (statusNow.status === "disconnected") {
        reset();
        setStatus("idle");
        localStorage.removeItem(STORAGE_KEY);
        return;
      }
      let configuration = session.current.configuration;
      try {
        configuration = await api.getConfiguration();
      } catch {
        /* keep previous */
      }
      let unshielded = session.current.addresses.unshieldedAddress;
      let shielded = session.current.addresses.shieldedAddress;
      let dust = session.current.addresses.dustAddress;
      try {
        unshielded = (await api.getUnshieldedAddress()).unshieldedAddress;
      } catch {
        /* keep */
      }
      try {
        shielded = (await api.getShieldedAddresses()).shieldedAddress;
      } catch {
        /* keep */
      }
      try {
        dust = (await api.getDustAddress()).dustAddress;
      } catch {
        /* keep */
      }
      const next: ConnectedSession = {
        ...session.current,
        status: statusNow,
        networkId: statusNow.status === "connected" ? statusNow.networkId : session.current.networkId,
        configuration,
        addresses: { unshieldedAddress: unshielded, shieldedAddress: shielded, dustAddress: dust },
        services: {
          networkId: configuration?.networkId ?? null,
          indexerUri: configuration?.indexerUri ?? null,
          indexerWsUri: configuration?.indexerWsUri ?? null,
          proverServerUri: configuration?.proverServerUri ?? null,
          substrateNodeUri: configuration?.substrateNodeUri ?? null,
        },
      };
      applySession(next);
    } catch (e) {
      reset();
      setStatus("error");
      setError(describeError(e));
      localStorage.removeItem(STORAGE_KEY);
    }
  }, [applySession, reset]);

  const disconnect = useCallback(() => {
    reset();
    setStatus("idle");
    setError(undefined);
    localStorage.removeItem(STORAGE_KEY);
  }, [reset]);

  useEffect(() => {
    let tries = 0;
    const tick = () => {
      const scanned = scanProviders();
      providerCache.current = scanned.providers;
      setProviders(scanned.infos);
      if (++tries >= 8) {
        clearInterval(id);
        setDetected(true);
      }
    };
    const id = setInterval(tick, 400);
    tick();
    const last = localStorage.getItem(STORAGE_KEY);
    const reconnect = setTimeout(() => {
      if (last) void connectTo(last, true);
    }, 500);
    return () => {
      clearInterval(id);
      clearTimeout(reconnect);
    };
  }, [connectTo]);

  useEffect(() => {
    if (status !== "connected") return;
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [status, refresh]);

  const value = useMemo<MidnightWalletState>(
    () => ({
      status,
      providers,
      detected,
      wallet,
      networkId,
      unshieldedAddress,
      shieldedAddress,
      dustAddress,
      services,
      error,
      updatedAt,
      connect: (key?: string) => connectTo(key, false),
      disconnect,
      refresh,
      sessionApi: () => session.current?.api ?? null,
    }),
    [
      status,
      providers,
      detected,
      wallet,
      networkId,
      unshieldedAddress,
      shieldedAddress,
      dustAddress,
      services,
      error,
      updatedAt,
      connectTo,
      disconnect,
      refresh,
    ],
  );

  return <MidnightWalletContext.Provider value={value}>{children}</MidnightWalletContext.Provider>;
}

export function useMidnightWallet(): MidnightWalletState {
  const ctx = useContext(MidnightWalletContext);
  if (!ctx) throw new Error("useMidnightWallet must be used inside <MidnightWalletProvider>");
  return ctx;
}
