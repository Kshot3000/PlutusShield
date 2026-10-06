"use client";

/**
 * CIP-30 wallet connection for the static site.
 *
 * Read-only for now: we ask the wallet for its network, change address and
 * balance so the app can show who is connected and what they hold on Preview.
 * Nothing here builds, signs or submits a transaction.
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
import { decodeAddress, parseValue, type DecodedAddress, type WalletBalance } from "@plutusshield/sdk/cip30";

interface Cip30Api {
  getNetworkId(): Promise<number>;
  getBalance(): Promise<string>;
  getChangeAddress(): Promise<string>;
  getUsedAddresses(): Promise<string[]>;
}

interface Cip30Provider {
  name?: string;
  icon?: string;
  apiVersion?: string;
  enable(): Promise<Cip30Api>;
  isEnabled(): Promise<boolean>;
}

declare global {
  interface Window {
    cardano?: Record<string, Cip30Provider | unknown>;
  }
}

export interface InstalledWallet {
  key: string;
  name: string;
  icon?: string;
}

/** Wallets we point people to when none is installed. Official sites only. */
export const RECOMMENDED_WALLETS = [
  { key: "lace", name: "Lace", url: "https://www.lace.io/" },
  { key: "eternl", name: "Eternl", url: "https://eternl.io/" },
  { key: "typhoncip30", name: "Typhon", url: "https://typhonwallet.io/" },
] as const;

export type WalletStatus = "idle" | "connecting" | "connected" | "error";

export interface WalletState {
  status: WalletStatus;
  wallets: InstalledWallet[];
  /** true once we've given injected wallets time to appear */
  detected: boolean;
  wallet?: InstalledWallet;
  networkId?: number;
  address?: DecodedAddress;
  balance?: WalletBalance;
  error?: string;
  updatedAt?: number;
  connect(key: string): Promise<void>;
  disconnect(): void;
  refresh(): Promise<void>;
}

const STORAGE_KEY = "plutusshield.wallet";
const WalletContext = createContext<WalletState | null>(null);

function isProvider(v: unknown): v is Cip30Provider {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as Cip30Provider).enable === "function" &&
    typeof (v as Cip30Provider).isEnabled === "function"
  );
}

function scanWallets(): InstalledWallet[] {
  if (typeof window === "undefined" || !window.cardano) return [];
  const seen = new Set<string>();
  const out: InstalledWallet[] = [];
  for (const [key, v] of Object.entries(window.cardano)) {
    if (!isProvider(v)) continue;
    const name = (v.name || key).trim();
    // Some wallets inject twice under different keys (e.g. a legacy alias).
    if (seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    const icon = typeof v.icon === "string" && /^data:image\/|^https:\/\//.test(v.icon) ? v.icon : undefined;
    out.push({ key, name, icon });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

function describeError(e: unknown): string {
  // CIP-30 APIError: { code: -1 InvalidRequest, -2 InternalError, -3 Refused, -4 AccountChange }
  const code = typeof e === "object" && e !== null && "code" in e ? (e as { code: unknown }).code : undefined;
  if (code === -3) return "The wallet declined the connection.";
  if (code === -4) return "The wallet switched accounts. Connect again.";
  const info = typeof e === "object" && e !== null && "info" in e ? String((e as { info: unknown }).info) : "";
  const msg = e instanceof Error ? e.message : info;
  return msg ? `Wallet error: ${msg}` : "The wallet didn't respond.";
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [wallets, setWallets] = useState<InstalledWallet[]>([]);
  const [detected, setDetected] = useState(false);
  const [status, setStatus] = useState<WalletStatus>("idle");
  const [wallet, setWallet] = useState<InstalledWallet>();
  const [networkId, setNetworkId] = useState<number>();
  const [address, setAddress] = useState<DecodedAddress>();
  const [balance, setBalance] = useState<WalletBalance>();
  const [error, setError] = useState<string>();
  const [updatedAt, setUpdatedAt] = useState<number>();
  const api = useRef<Cip30Api | null>(null);

  const reset = useCallback(() => {
    api.current = null;
    setWallet(undefined);
    setNetworkId(undefined);
    setAddress(undefined);
    setBalance(undefined);
    setUpdatedAt(undefined);
  }, []);

  const read = useCallback(async (a: Cip30Api) => {
    const [net, bal, change] = await Promise.all([a.getNetworkId(), a.getBalance(), a.getChangeAddress()]);
    let addrHex = change;
    if (!addrHex) addrHex = (await a.getUsedAddresses())[0] ?? "";
    setNetworkId(net);
    setBalance(parseValue(bal));
    setAddress(addrHex ? decodeAddress(addrHex) : undefined);
    setUpdatedAt(Date.now());
  }, []);

  const connectTo = useCallback(
    async (key: string, silent: boolean) => {
      const provider = window.cardano?.[key];
      if (!isProvider(provider)) {
        if (!silent) {
          setStatus("error");
          setError("That wallet isn't available in this browser.");
        }
        return;
      }
      if (silent && !(await provider.isEnabled().catch(() => false))) return;
      setStatus("connecting");
      setError(undefined);
      try {
        const a = await provider.enable();
        api.current = a;
        setWallet(scanWallets().find((w) => w.key === key) ?? { key, name: provider.name ?? key });
        await read(a);
        setStatus("connected");
        localStorage.setItem(STORAGE_KEY, key);
      } catch (e) {
        reset();
        setStatus(silent ? "idle" : "error");
        if (!silent) setError(describeError(e));
      }
    },
    [read, reset],
  );

  const refresh = useCallback(async () => {
    if (!api.current) return;
    try {
      await read(api.current);
    } catch (e) {
      reset();
      setStatus("error");
      setError(describeError(e));
      localStorage.removeItem(STORAGE_KEY);
    }
  }, [read, reset]);

  const disconnect = useCallback(() => {
    // CIP-30 has no revoke call; we forget the session on our side. To fully
    // revoke, remove the site from the wallet's "connected dApps" list.
    reset();
    setStatus("idle");
    setError(undefined);
    localStorage.removeItem(STORAGE_KEY);
  }, [reset]);

  // Wallet extensions inject window.cardano after page scripts run, so scan a few times.
  useEffect(() => {
    let tries = 0;
    const tick = () => {
      setWallets(scanWallets());
      if (++tries >= 6) {
        clearInterval(id);
        setDetected(true);
      }
    };
    const id = setInterval(tick, 350);
    tick();
    const last = localStorage.getItem(STORAGE_KEY);
    const reconnect = setTimeout(() => {
      if (last) void connectTo(last, true);
    }, 400);
    return () => {
      clearInterval(id);
      clearTimeout(reconnect);
    };
  }, [connectTo]);

  // Keep the balance fresh while connected.
  useEffect(() => {
    if (status !== "connected") return;
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    const id = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 30_000);
    return () => {
      window.removeEventListener("focus", onFocus);
      clearInterval(id);
    };
  }, [status, refresh]);

  const value = useMemo<WalletState>(
    () => ({
      status,
      wallets,
      detected,
      wallet,
      networkId,
      address,
      balance,
      error,
      updatedAt,
      connect: (key: string) => connectTo(key, false),
      disconnect,
      refresh,
    }),
    [status, wallets, detected, wallet, networkId, address, balance, error, updatedAt, connectTo, disconnect, refresh],
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet(): WalletState {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used inside <WalletProvider>");
  return ctx;
}

/** Tokens the preview build knows how to label in a wallet balance. */
export const PREVIEW_USDC_ID = process.env.NEXT_PUBLIC_PREVIEW_USDC_POLICY_ID
  ? `${process.env.NEXT_PUBLIC_PREVIEW_USDC_POLICY_ID.toLowerCase()}.745553444378`
  : undefined;
export const PREVIEW_SCRIPT_HASH = process.env.NEXT_PUBLIC_PREVIEW_SCRIPT_HASH?.toLowerCase();
