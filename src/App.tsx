import {
  type Dispatch,
  type ReactNode,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { askWorker, BRIDGE, type Entitlement, type FriendRecord, type RosterCache, VAULT } from "./protocol";

const SPEEDS = [
  { id: "slow", delayMs: 16_000, emoji: "🐢", paid: false },
  { id: "normal", delayMs: 8_000, emoji: "🚶", paid: false },
  { id: "fast", delayMs: 3_000, emoji: "🐇", paid: true },
  { id: "ultra", delayMs: 1_000, emoji: "🚀", paid: true }
] as const;

type SpeedId = (typeof SPEEDS)[number]["id"];
type Filters = { mutual: boolean; nonMutual: boolean; noPhoto: boolean; sortAz: boolean };
type Status = { kicker: string; message: string; busy: boolean };
type RunBadge = { text: string; tone: "waiting" | "normal" | "ok" };

const DEFAULT_SPEED: SpeedId = "slow";
const ROSTER_VERSION = 2;
const PAGE_PAUSE_MS = 900;
const RETRY_DELAYS = [5_000, 15_000, 45_000];
const MAX_ATTEMPTS = 6;
const RENDER_BATCH = 200;
const FREE_EXPORT_LIMIT = 20;
const EMPTY_ACCESS: Entitlement = { unlimited: false, used: 0, limit: 20, remaining: 20 };

const t = (key: string, substitutions?: string | string[]) =>
  chrome.i18n.getMessage(key, substitutions) || key;
const wait = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds));

function useLiveState<T>(initial: T): [T, Dispatch<SetStateAction<T>>, React.MutableRefObject<T>] {
  const [value, setValueRaw] = useState(initial);
  const live = useRef(value);
  const setValue = useCallback<Dispatch<SetStateAction<T>>>(next => {
    const resolved = typeof next === "function" ? (next as (value: T) => T)(live.current) : next;
    live.current = resolved;
    setValueRaw(resolved);
  }, []);
  return [value, setValue, live];
}

function hasMutual(friend: FriendRecord) {
  return /\p{Nd}/u.test(friend.meta || "");
}

function explainFailure(reason: string) {
  if (reason === "session_absent_v2") return t("errorNotLoggedIn");
  if (reason === "session_token_unavailable_v2") return t("errorNoToken");
  return t("errorFacebookChanged");
}

function diagnosticCode(reason: unknown): string | null {
  const text = String(reason || "");
  if (!text || text === "session_absent_v2" || text === "session_token_unavailable_v2") return null;
  if (text === "roster_payload_missing_v2") return "roster_contract_missing_v2";
  if (text.startsWith("facebook_payload_invalid_v2")) return "facebook_response_invalid_v2";
  if (text === "removal_payload_unexpected_v2" || text === "friendship_unchanged_v2") return "friend_action_declined_v2";
  return "facebook_operation_failure_v2";
}

async function migratePanelVault() {
  const legacy = {
    preferences: "cms_unfriender_settings",
    roster: "cms_unfriender_friends_cache",
    reviewSeen: "mass-unfriender-review-opened"
  };
  const values = await chrome.storage.local.get([
    VAULT.preferences,
    VAULT.roster,
    VAULT.reviewSeen,
    legacy.preferences,
    legacy.roster,
    legacy.reviewSeen
  ]);
  const additions: Record<string, unknown> = {};
  if (values[VAULT.preferences] == null && values[legacy.preferences] != null) {
    additions[VAULT.preferences] = values[legacy.preferences];
  }
  if (values[VAULT.reviewSeen] == null && values[legacy.reviewSeen] != null) {
    additions[VAULT.reviewSeen] = values[legacy.reviewSeen];
  }
  if (values[VAULT.roster] == null && values[legacy.roster] != null) {
    const old = values[legacy.roster] as Record<string, unknown>;
    const { userId, ...roster } = old;
    additions[VAULT.roster] = {
      ...roster,
      version: ROSTER_VERSION,
      accountId: userId
    };
  }
  if (Object.keys(additions).length) await chrome.storage.local.set(additions);
  await chrome.storage.local.remove(Object.values(legacy));
}

function StepHeader({ number, title, badge, tone = "normal" }: {
  number: number;
  title: string;
  badge: string;
  tone?: "waiting" | "normal" | "ok";
}) {
  return <div className="step-title">
    <span className="step-number">{number}</span>
    <h2>{title}</h2>
    <span className={`step-badge ${tone === "normal" ? "" : tone}`}>{badge}</span>
  </div>;
}

function Modal({ open, children, onClose }: { open: boolean; children: ReactNode; onClose: (value: string) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    if (open && !node.open) node.showModal();
    if (!open && node.open) node.close();
  }, [open]);
  return <dialog ref={dialog} onClose={event => onClose(event.currentTarget.returnValue)}>{children}</dialog>;
}

export function App() {
  const [loggedIn, setLoggedIn, loggedInRef] = useLiveState<boolean | null>(null);
  const [, setAccountId, accountIdRef] = useLiveState<string | null>(null);
  const [friends, setFriends, friendsRef] = useLiveState<FriendRecord[]>([]);
  const [selected, setSelected, selectedRef] = useLiveState<Set<string>>(new Set());
  const [, setCursor, cursorRef] = useLiveState<string | null>(null);
  const [hasMore, setHasMore, hasMoreRef] = useLiveState(true);
  const [loading, setLoading, loadingRef] = useLiveState(false);
  const [running, setRunning, runningRef] = useLiveState(false);
  const [access, setAccess, accessRef] = useLiveState<Entitlement>(EMPTY_ACCESS);
  const [speedId, setSpeedId, speedRef] = useLiveState<SpeedId>(DEFAULT_SPEED);
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<Filters>({ mutual: false, nonMutual: false, noPhoto: false, sortAz: false });
  const [renderLimit, setRenderLimit] = useState(RENDER_BATCH);
  const [loadingText, setLoadingText] = useState("");
  const [status, setStatus] = useState<Status>({ kicker: t("ready"), message: t("selectToStart"), busy: false });
  const [runBadge, setRunBadge] = useState<RunBadge>({ text: t("waiting"), tone: "waiting" });
  const [runProgress, setRunProgress] = useState({ processed: 0, total: 0 });
  const [breakage, setBreakage] = useState<string | null>(null);
  const [reportSent, setReportSent] = useState(false);
  const [reportState, setReportState] = useState<"idle" | "sending" | "failed">("idle");
  const [confirmCount, setConfirmCount] = useState<number | null>(null);
  const [confirmChecked, setConfirmChecked] = useState(false);
  const confirmResolver = useRef<((confirmed: boolean) => void) | null>(null);
  const [upgrade, setUpgrade] = useState<{ open: boolean; limitReached: boolean }>({ open: false, limitReached: false });
  const [licenseKey, setLicenseKey] = useState("");
  const [licenseState, setLicenseState] = useState<"idle" | "checking" | "active" | "invalid">("idle");
  const [review, setReview] = useState<{ open: boolean; removed: number; remaining: string; alreadySeen: boolean }>({
    open: false, removed: 0, remaining: "0", alreadySeen: false
  });
  const [reloading, setReloading] = useState(false);

  const mounted = useRef(true);
  const cancelLoading = useRef(false);
  const stopRequested = useRef(false);
  const cacheTimer = useRef<number | null>(null);
  const countdownTimer = useRef<number | null>(null);
  const licenseTimer = useRef<number | null>(null);
  const loadFriendsRef = useRef<() => Promise<void>>(async () => {});

  const visibleFriends = useMemo(() => {
    let list = friends;
    const query = search.trim().toLocaleLowerCase();
    if (query) list = list.filter(friend => friend.name.toLocaleLowerCase().includes(query));
    if (filters.mutual) list = list.filter(hasMutual);
    if (filters.nonMutual) list = list.filter(friend => !hasMutual(friend));
    if (filters.noPhoto) list = list.filter(friend => !friend.avatar);
    if (filters.sortAz) list = [...list].sort((a, b) => a.name.localeCompare(b.name));
    return list;
  }, [friends, search, filters]);

  const activeSpeed = useCallback(() => {
    const chosen = SPEEDS.find(speed => speed.id === speedRef.current) || SPEEDS[0];
    return chosen.paid && !accessRef.current.unlimited ? SPEEDS[0] : chosen;
  }, [accessRef, speedRef]);

  const updateSelectionStatus = useCallback((count: number) => {
    if (runningRef.current || breakage) return;
    if (count) {
      setRunBadge({ text: t("readyBadge"), tone: "normal" });
      setStatus({ kicker: t("ready"), message: t("willRemoveCount", [String(count)]), busy: false });
    } else {
      setRunBadge({ text: t("waiting"), tone: "waiting" });
      setStatus({ kicker: t("ready"), message: t("selectToStart"), busy: false });
    }
  }, [breakage, runningRef]);

  const writeRoster = useCallback(() => {
    if (cacheTimer.current) window.clearTimeout(cacheTimer.current);
    cacheTimer.current = window.setTimeout(() => {
      cacheTimer.current = null;
      const accountId = accountIdRef.current;
      if (!accountId) return;
      const snapshot: RosterCache = {
        version: ROSTER_VERSION,
        accountId,
        friends: friendsRef.current,
        cursor: cursorRef.current,
        hasMore: hasMoreRef.current,
        updatedAt: Date.now()
      };
      chrome.storage.local.set({ [VAULT.roster]: snapshot }).catch(() => {});
    }, 400);
  }, [accountIdRef, cursorRef, friendsRef, hasMoreRef]);

  const showBreakage = useCallback((code: string) => {
    setBreakage(code);
  }, []);

  const clearBreakage = useCallback(() => setBreakage(null), []);

  const refreshEntitlement = useCallback(async (force = false, suppliedKey?: string) => {
    const response = await askWorker<{ ok?: boolean; entitlement?: Entitlement }>({
      type: force ? BRIDGE.verifyEntitlement : BRIDGE.readEntitlement,
      licenseToken: suppliedKey
    });
    if (response?.ok && response.entitlement) setAccess(response.entitlement);
    return response?.entitlement || accessRef.current;
  }, [accessRef, setAccess]);

  const openUpgrade = useCallback((limitReached: boolean) => {
    if (accessRef.current.unlimited) return;
    setLicenseState("idle");
    setUpgrade({ open: true, limitReached });
  }, [accessRef]);

  const stopCountdown = useCallback(() => {
    if (countdownTimer.current) window.clearInterval(countdownTimer.current);
    countdownTimer.current = null;
  }, []);

  const waitWithCountdown = useCallback((milliseconds: number, label: string) => {
    stopCountdown();
    const until = Date.now() + milliseconds;
    return new Promise<void>(resolve => {
      const tick = () => {
        const left = Math.max(0, Math.ceil((until - Date.now()) / 1000));
        setStatus({ kicker: label, message: t("nextInSeconds", [String(left)]), busy: true });
        if (stopRequested.current || left <= 0) {
          stopCountdown();
          resolve();
        }
      };
      tick();
      countdownTimer.current = window.setInterval(tick, 250);
    });
  }, [stopCountdown]);

  const loadFriends = async () => {
    if (loadingRef.current || !hasMoreRef.current || !loggedInRef.current) return;
    setLoading(true);
    cancelLoading.current = false;
    let attempts = 0;
    setLoadingText(t("loadingCount", [String(friendsRef.current.length)]));

    try {
      while (hasMoreRef.current && !cancelLoading.current && mounted.current) {
        const response = await askWorker<{
          ok?: boolean; error?: string; records?: FriendRecord[]; nextCursor?: string | null; more?: boolean;
        }>({ type: BRIDGE.fetchFriendPage, pageCursor: cursorRef.current });

        if (!response?.ok) {
          const reason = response?.error || "roster_load_exhausted_v2";
          if (reason === "session_absent_v2") {
            setLoggedIn(false);
            setStatus({ kicker: t("error"), message: explainFailure(reason), busy: false });
            return;
          }
          attempts += 1;
          if (attempts >= MAX_ATTEMPTS) {
            setStatus({ kicker: t("error"), message: explainFailure(reason), busy: false });
            const code = diagnosticCode(reason);
            if (code) showBreakage(code);
            return;
          }
          const delay = RETRY_DELAYS[Math.min(attempts - 1, RETRY_DELAYS.length - 1)];
          const until = Date.now() + delay;
          while (Date.now() < until && !cancelLoading.current) {
            setLoadingText(t("retryingIn", [String(Math.max(0, Math.ceil((until - Date.now()) / 1000)))]));
            await wait(250);
          }
          continue;
        }

        attempts = 0;
        clearBreakage();
        const known = new Set(friendsRef.current.map(friend => friend.id));
        const next = [...friendsRef.current];
        for (const friend of response.records || []) {
          if (!known.has(friend.id)) {
            known.add(friend.id);
            next.push(friend);
          }
        }
        setFriends(next);
        setCursor(response.nextCursor ?? null);
        setHasMore(Boolean(response.more));
        writeRoster();
        setLoadingText(t("loadingCount", [String(next.length)]));
        if (response.more && !cancelLoading.current) await wait(PAGE_PAUSE_MS);
      }
    } finally {
      if (mounted.current) setLoading(false);
    }
  };
  loadFriendsRef.current = loadFriends;

  const startPanel = useCallback(async () => {
    const response = await askWorker<{ loggedIn?: boolean; accountId?: string }>({ type: BRIDGE.probeSession });
    const online = Boolean(response?.loggedIn);
    setLoggedIn(online);
    setAccountId(response?.accountId || null);
    if (!online) return;

    const stored = await chrome.storage.local.get(VAULT.roster).catch(() => ({})) as Record<string, unknown>;
    const cache = stored[VAULT.roster] as RosterCache | undefined;
    if (cache?.version === ROSTER_VERSION && cache.accountId === response?.accountId && Array.isArray(cache.friends)) {
      setFriends(cache.friends);
      setCursor(cache.cursor ?? null);
      setHasMore(Boolean(cache.hasMore));
    }
    await loadFriendsRef.current();
  }, [setAccountId, setCursor, setFriends, setHasMore, setLoggedIn]);

  useEffect(() => {
    document.documentElement.lang = chrome.i18n.getUILanguage().split("-")[0];
    mounted.current = true;
    void (async () => {
      await migratePanelVault();
      const stored = await chrome.storage.local.get(VAULT.preferences) as Record<string, { speed?: SpeedId } | undefined>;
      const saved = stored[VAULT.preferences]?.speed;
      if (SPEEDS.some(speed => speed.id === saved)) setSpeedId(saved!);
      await refreshEntitlement();
      await startPanel();
    })();

    const listener = (message: { type?: string; entitlement?: Entitlement }) => {
      if (message.type === BRIDGE.entitlementUpdated && message.entitlement) setAccess(message.entitlement);
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => {
      mounted.current = false;
      cancelLoading.current = true;
      stopRequested.current = true;
      chrome.runtime.onMessage.removeListener(listener);
      if (cacheTimer.current) window.clearTimeout(cacheTimer.current);
      if (licenseTimer.current) window.clearInterval(licenseTimer.current);
      stopCountdown();
    };
  }, [refreshEntitlement, setAccess, setSpeedId, startPanel, stopCountdown]);

  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.ctrlKey || event.metaKey || event.altKey) return;
      const tag = document.activeElement?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      event.preventDefault();
      document.querySelector<HTMLInputElement>("#searchInput")?.focus();
    };
    document.addEventListener("keydown", listener);
    return () => document.removeEventListener("keydown", listener);
  }, []);

  const toggleFriend = (friendId: string, checked: boolean) => {
    const next = new Set(selectedRef.current);
    checked ? next.add(friendId) : next.delete(friendId);
    setSelected(next);
    updateSelectionStatus(next.size);
  };

  const toggleFilter = (key: keyof Filters) => {
    setFilters(current => {
      const next = { ...current, [key]: !current[key] };
      if (key === "mutual" && next.mutual) next.nonMutual = false;
      if (key === "nonMutual" && next.nonMutual) next.mutual = false;
      return next;
    });
    setRenderLimit(RENDER_BATCH);
    document.querySelector("#friendList")?.scrollTo({ top: 0 });
  };

  const toggleAll = (checked: boolean) => {
    const next = new Set(selectedRef.current);
    for (const friend of visibleFriends) checked ? next.add(friend.id) : next.delete(friend.id);
    setSelected(next);
    updateSelectionStatus(next.size);
  };

  const reloadRoster = async () => {
    if (runningRef.current) return;
    cancelLoading.current = true;
    setReloading(true);
    if (cacheTimer.current) window.clearTimeout(cacheTimer.current);
    await chrome.storage.local.remove(VAULT.roster);
    setFriends([]);
    setSelected(new Set());
    setCursor(null);
    setHasMore(true);
    setRenderLimit(RENDER_BATCH);
    clearBreakage();
    setRunBadge({ text: t("waiting"), tone: "waiting" });
    setStatus({ kicker: t("ready"), message: t("selectToStart"), busy: false });
    while (loadingRef.current) await wait(120);
    setReloading(false);
    await loadFriendsRef.current();
  };

  const exportSelection = () => {
    const ordered = filters.sortAz ? [...friendsRef.current].sort((a, b) => a.name.localeCompare(b.name)) : friendsRef.current;
    const rows = ordered.filter(friend => selectedRef.current.has(friend.id));
    if (!rows.length) return;
    if (!accessRef.current.unlimited && rows.length > FREE_EXPORT_LIMIT) return openUpgrade(false);
    const csvCell = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;
    const header = [t("csvName"), t("csvProfile"), t("csvDetails"), t("csvHasPhoto")];
    const body = rows.map(friend => [friend.name, friend.url, friend.meta || "", friend.avatar ? t("yes") : t("no")].map(csvCell).join(","));
    const csv = `﻿${[header.map(csvCell).join(","), ...body].join("\r\n")}\r\n`;
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `facebook-friends-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 4_000);
  };

  const requestConfirmation = (count: number) => new Promise<boolean>(resolve => {
    confirmResolver.current = resolve;
    setConfirmChecked(false);
    setConfirmCount(count);
  });

  const finishConfirmation = (confirmed: boolean) => {
    setConfirmCount(null);
    confirmResolver.current?.(confirmed);
    confirmResolver.current = null;
  };

  const celebrate = async (processed: number) => {
    const stored = await chrome.storage.local.get(VAULT.reviewSeen).catch(() => ({})) as Record<string, unknown>;
    const alreadySeen = Boolean(stored[VAULT.reviewSeen]);
    window.setTimeout(() => {
      if (!mounted.current) return;
      setReview({
        open: true,
        removed: processed,
        remaining: hasMoreRef.current ? `${friendsRef.current.length}+` : String(friendsRef.current.length),
        alreadySeen
      });
    }, 450);
  };

  const runRemoval = async () => {
    if (runningRef.current || !selectedRef.current.size) return;
    const currentAccess = await refreshEntitlement();
    if (!currentAccess.unlimited && currentAccess.remaining <= 0) return openUpgrade(true);
    const batch = friendsRef.current.filter(friend => selectedRef.current.has(friend.id));
    if (!(await requestConfirmation(batch.length))) return;

    cancelLoading.current = true;
    while (loadingRef.current) await wait(120);
    setRunning(true);
    stopRequested.current = false;
    setBreakage(null);
    setRunBadge({ text: t("working"), tone: "normal" });

    const pace = activeSpeed();
    let processed = 0;
    let failed = 0;
    let limitReached = false;
    let failureCode: string | null = null;
    setRunProgress({ processed: 0, total: batch.length });

    for (const friend of batch) {
      if (stopRequested.current) break;
      setStatus({ kicker: t("working"), message: t("removingName", [friend.name]), busy: true });
      const response = await askWorker<{
        outcome?: "limit" | "success" | "failed"; reason?: string; entitlement?: Entitlement;
      }>({ type: BRIDGE.removeFriend, target: friend });
      if (response?.entitlement) setAccess(response.entitlement);
      if (response?.outcome === "limit") {
        limitReached = true;
        break;
      }
      if (response?.outcome === "success") {
        processed += 1;
        const nextSelected = new Set(selectedRef.current);
        nextSelected.delete(friend.id);
        setSelected(nextSelected);
        setFriends(friendsRef.current.filter(item => item.id !== friend.id));
        writeRoster();
      } else {
        failed += 1;
        failureCode = diagnosticCode(response?.reason) || failureCode;
        if (response?.reason === "session_absent_v2" || response?.reason === "session_token_unavailable_v2") {
          setStatus({ kicker: t("error"), message: explainFailure(response.reason), busy: false });
          break;
        }
      }
      setRunProgress({ processed: processed + failed, total: batch.length });
      const last = friend === batch[batch.length - 1];
      if (!last && !stopRequested.current) await waitWithCountdown(pace.delayMs, t("working"));
    }

    stopCountdown();
    setRunning(false);
    stopRequested.current = false;
    if (failureCode) showBreakage(failureCode);

    if (limitReached) {
      setRunBadge({ text: t("freePlanLimit"), tone: "waiting" });
      setStatus({ kicker: t("freePlanLimit"), message: t("limitStoppedBatch", [String(processed)]), busy: false });
      openUpgrade(true);
    } else {
      setRunBadge({ text: failed ? t("finishedWithIssues") : t("complete"), tone: failed ? "waiting" : "ok" });
      setStatus({
        kicker: failed ? t("finishedWithIssues") : t("complete"),
        message: failed
          ? t("removedWithFailures", [String(processed), String(failed)])
          : t("removedCount", [String(processed)]),
        busy: false
      });
      if (processed > 0) await celebrate(processed);
    }
    if (hasMoreRef.current && loggedInRef.current) void loadFriendsRef.current();
  };

  const submitReport = async () => {
    setReportState("sending");
    const response = await askWorker<{ ok?: boolean }>({ type: BRIDGE.submitDiagnostic, code: breakage || "roster_load_exhausted_v2" });
    if (response?.ok) {
      setReportSent(true);
      setReportState("idle");
    } else setReportState("failed");
  };

  const chooseSpeed = (id: SpeedId) => {
    const speed = SPEEDS.find(item => item.id === id)!;
    if (speed.paid && !access.unlimited) return openUpgrade(false);
    setSpeedId(id);
    chrome.storage.local.set({ [VAULT.preferences]: { speed: id } }).catch(() => {});
  };

  const startLicensePolling = () => {
    if (licenseTimer.current) return;
    licenseTimer.current = window.setInterval(async () => {
      const state = await refreshEntitlement(true);
      if (!state.unlimited) return;
      if (licenseTimer.current) window.clearInterval(licenseTimer.current);
      licenseTimer.current = null;
      setLicenseState("active");
      window.setTimeout(() => setUpgrade(value => ({ ...value, open: false })), 700);
    }, 4_000);
  };

  const unlockLicense = async () => {
    const key = licenseKey.trim();
    if (!key) return;
    setLicenseState("checking");
    const state = await refreshEntitlement(true, key);
    if (state.unlimited) {
      setLicenseState("active");
      window.setTimeout(() => setUpgrade(value => ({ ...value, open: false })), 700);
    } else setLicenseState("invalid");
  };

  const allSelected = visibleFriends.length > 0 && visibleFriends.every(friend => selected.has(friend.id));
  const someSelected = visibleFriends.some(friend => selected.has(friend.id));
  const currentSpeed = activeSpeed().id;
  const listBadge = loading
    ? { text: t("loading"), tone: "normal" as const }
    : hasMore
      ? { text: t("paused"), tone: "waiting" as const }
      : { text: t("listLoaded", [String(friends.length)]), tone: "ok" as const };
  const runStepMode = running || selected.size ? "active" : "disabled";
  const shownFriends = visibleFriends.slice(0, renderLimit);
  const limit = access.limit || 20;
  const used = Math.min(limit, Math.max(0, access.used || 0));

  return <>
    <header className="topbar">
      <img className="brand-mark" src="icons/48.png" width="40" height="40" alt="" />
      <div className="brand-copy"><h1>{t("panelTitle")}</h1><p>{t("panelSubtitle")}</p></div>
      <button className={`upgrade-badge${access.unlimited ? " unlimited" : ""}`} type="button"
        disabled={access.unlimited} onClick={() => openUpgrade(false)}>
        {access.unlimited ? t("unlimitedBadge") : t("getUnlimited")}
      </button>
    </header>

    <main>
      <section className={`card step-card step-${loggedIn ? "done" : "active"}`}>
        <StepHeader number={1} title={t("connectTitle")}
          badge={loggedIn === null ? t("checking") : loggedIn ? t("connected") : t("notConnected")}
          tone={loggedIn ? "ok" : "waiting"} />
        <p className="step-copy">{t("connectDescription")}</p>
        <div className="connection-row" aria-live="polite">
          <span className={`connection-dot${loggedIn ? " online" : ""}`} />
          <div className="connection-copy">
            <strong>{loggedIn === null ? t("checkingSession") : loggedIn ? t("sessionReady") : t("sessionMissing")}</strong>
            <span>{t("localOnly")}</span>
          </div>
          <button className="icon-button" type="button" aria-label={t("refresh")} onClick={() => {
            if (runningRef.current) return;
            setLoggedIn(null);
            void refreshEntitlement();
            void startPanel();
          }}>↻</button>
        </div>
        {loggedIn === false && <div className="offline-view">
          <p>{t("loginDescription")}</p>
          <button className="primary-button" type="button" onClick={() => askWorker({ type: BRIDGE.openFacebookFriends })}>{t("openFacebook")}</button>
        </div>}
      </section>

      {loggedIn && <div id="controlsView">
        {breakage && <section className="card breakage-card">
          <div className="breakage-head"><span className="breakage-icon" aria-hidden="true">!</span><h2>{t("breakageTitle")}</h2></div>
          <p>{t("breakageBody")}</p><p className="breakage-hint">{t("breakageHint")}</p>
          {!reportSent && <button className="secondary-button" type="button" disabled={reportState === "sending"} onClick={submitReport}>{t("reportButton")}</button>}
          <p className={`report-status ${reportSent ? "success" : reportState === "failed" ? "error" : ""}`} aria-live="polite">
            {reportSent ? t("reportSent") : reportState === "sending" ? t("reportSending") : reportState === "failed" ? t("reportFailed") : ""}
          </p>
        </section>}

        <section className={`card step-card step-${friends.length ? "done" : "active"}`}>
          <StepHeader number={2} title={t("selectTitle")} badge={listBadge.text} tone={listBadge.tone} />
          <div className="search-wrap"><span className="search-icon" aria-hidden="true">⌕</span>
            <input id="searchInput" className="search-input" type="search" autoComplete="off" spellCheck={false}
              placeholder={t("searchPlaceholder")} value={search} disabled={running}
              onChange={event => { setSearch(event.target.value); setRenderLimit(RENDER_BATCH); }} />
          </div>
          <div className="filter-chips" role="group" aria-label={t("filters")}>
            {(["mutual", "nonMutual", "noPhoto", "sortAz"] as const).map(key => <button key={key} className="fchip" type="button"
              disabled={running} aria-pressed={filters[key]} onClick={() => toggleFilter(key)}>
              {t(key === "mutual" ? "filterMutual" : key === "nonMutual" ? "filterNonMutual" : key === "noPhoto" ? "filterNoPhoto" : "sortAz")}
            </button>)}
          </div>
          <div className="list-meta">
            <span className="count-line"><strong>{visibleFriends.length}</strong> / <span>{friends.length}</span></span>
            <button className={`round-button${reloading ? " spinning" : ""}`} type="button" aria-label={t("reload")} disabled={running} onClick={reloadRoster}>↻</button>
            <button className="chip-button" type="button" disabled={running || !selected.size} onClick={exportSelection}><span aria-hidden="true">↓</span> {t("export")}</button>
            <label className="select-all"><input type="checkbox" checked={allSelected}
              ref={node => { if (node) node.indeterminate = !allSelected && someSelected; }}
              disabled={running || !visibleFriends.length} onChange={event => toggleAll(event.target.checked)} />
              <span>{t("selectAll")}</span></label>
          </div>
          {loading && <div className="loading-strip" aria-live="polite"><span className="loading-bar"><i /></span><span>{loadingText}</span></div>}
          <div id="friendList" className="friend-list" aria-live="polite" onScroll={event => {
            const node = event.currentTarget;
            if (node.scrollHeight - node.scrollTop - node.clientHeight <= 120 && renderLimit < visibleFriends.length) {
              setRenderLimit(value => value + RENDER_BATCH);
            }
          }}>
            {!visibleFriends.length ? <p className="list-empty">{loading ? t("loadingFriends") : search || filters.mutual || filters.nonMutual || filters.noPhoto ? t("noMatches") : t("noFriendsLoaded")}</p>
              : <>{shownFriends.map(friend => <label key={friend.id} className={`friend-row${selected.has(friend.id) ? " selected" : ""}`}>
                <input type="checkbox" checked={selected.has(friend.id)} disabled={running} onChange={event => toggleFriend(friend.id, event.target.checked)} />
                <img className="friend-avatar" width="32" height="32" alt="" loading="lazy" src={friend.avatar || undefined} />
                <span className="friend-copy"><strong>{friend.name}</strong><span>{friend.meta || friend.handle || ""}</span></span>
              </label>)}{visibleFriends.length > shownFriends.length && <p className="list-empty">{t("scrollForMore", [String(visibleFriends.length - shownFriends.length)])}</p>}</>}
          </div>
        </section>

        <section className={`card step-card step-${runStepMode}`}>
          <StepHeader number={3} title={t("removeTitle")} badge={runBadge.text} tone={runBadge.tone} />
          <div className="speed-grid" role="group" aria-label={t("speed")}>
            {SPEEDS.map(speed => {
              const locked = speed.paid && !access.unlimited;
              return <button key={speed.id} type="button" disabled={running} title={locked ? t("speedLockedHint") : undefined}
                className={`speed-option${speed.id === currentSpeed ? " active" : ""}${locked ? " locked" : ""}`}
                onClick={() => chooseSpeed(speed.id)}>
                <span className="speed-emoji">{speed.emoji}</span><span className="speed-name">{t(`speed_${speed.id}`)}</span>
                <span className="speed-pace">{locked ? "🔒" : t("secondsEach", [String(speed.delayMs / 1000)])}</span>
              </button>;
            })}
          </div>
          <p className="speed-hint">{access.unlimited ? t("speedHintPaid") : t("speedHintFree")}</p>
          <div className="process-status" aria-live="polite">
            <div className="status-heading">
              {status.busy ? <span className="spinner" /> : <span className="status-ready" aria-hidden="true">✓</span>}
              <div><span>{status.kicker}</span><strong>{status.message}</strong></div>
              {running && <button className="stop-button" type="button" onClick={() => {
                stopRequested.current = true;
                setStatus({ kicker: t("stopping"), message: t("stoppingNote"), busy: true });
              }}>{t("stop")}</button>}
            </div>
            {runProgress.total > 0 && <section className="progress-block"><div className="progress-label"><span>{t("batchProgress")}</span>
              <strong>{runProgress.processed}/{runProgress.total}</strong></div><div className="track"><i style={{ width: `${Math.min(100, runProgress.processed / runProgress.total * 100)}%` }} /></div></section>}
            {!access.unlimited && <section className={`progress-block quota-progress${used >= limit ? " limit" : ""}`}>
              <div className="progress-label"><span>{t("dailyFreeUsage")}</span><strong>{used}/{limit}</strong></div>
              <div className="track"><i style={{ width: `${Math.min(100, used / limit * 100)}%` }} /></div>
              <div className="quota-footer"><span>{t("quotaExplanation")}</span><button type="button" onClick={() => openUpgrade(false)}>{t("getUnlimited")}</button></div>
            </section>}
          </div>
          <div style={{ marginTop: 12 }}><button className="danger-button" type="button" disabled={running || !selected.size} onClick={runRemoval}>{t("removeSelected")}</button></div>
        </section>
      </div>}

      <footer><p><span aria-hidden="true">◈</span> {t("localPrivacy")} · {t("noData")}</p><span>v{chrome.runtime.getManifest().version}</span></footer>
    </main>

    <Modal open={confirmCount !== null} onClose={value => finishConfirmation(value === "confirm")}>
      <form method="dialog" className="dialog-content">
        <div className="dialog-icon danger">!</div><h2>{t("confirmTitleCount", [String(confirmCount || 0)])}</h2>
        <p>{t("confirmDescription")}</p><label className="confirm-check"><input type="checkbox" checked={confirmChecked} onChange={event => setConfirmChecked(event.target.checked)} />
          <span>{t("confirmCheckbox")}</span></label>
        <div className="dialog-actions"><button value="cancel" className="secondary-button">{t("cancel")}</button>
          <button value="confirm" className="danger-button" disabled={!confirmChecked}>{t("removeNow")}</button></div>
      </form>
    </Modal>

    <Modal open={upgrade.open} onClose={() => setUpgrade(value => ({ ...value, open: false }))}>
      <form method="dialog" className="dialog-content">
        <button className="dialog-close" value="close" aria-label={t("close")}>×</button><div className="dialog-icon upgrade">∞</div>
        <p className="dialog-eyebrow">{upgrade.limitReached ? t("freePlanLimit") : t("upgradeEyebrow")}</p>
        <h2>{upgrade.limitReached ? t("dailyLimitTitle") : t("upgradeTitle")}</h2>
        <p>{upgrade.limitReached ? t("dailyLimitDescription") : t("upgradeDescription")}</p>
        <ul className="benefits"><li>{t("unlimitedBenefit")}</li><li>{t("speedBenefit")}</li><li>{t("exportBenefit")}</li><li>{t("lifetimeBenefit")}</li></ul>
        <button className="primary-button" type="button" onClick={async () => { await askWorker({ type: BRIDGE.launchCheckout }); startLicensePolling(); }}>{t("getUnlimitedAccess")}</button>
        <div className="license-divider"><span>{t("alreadyPurchased")}</span></div>
        <div className="license-row"><input type="text" autoComplete="off" spellCheck={false} placeholder={t("licensePlaceholder")} value={licenseKey} onChange={event => setLicenseKey(event.target.value)} />
          <button type="button" disabled={licenseState === "checking"} onClick={unlockLicense}>{t("unlock")}</button></div>
        <p className={`license-message${licenseState === "active" ? " success" : licenseState === "invalid" ? " error" : ""}`} aria-live="polite">
          {licenseState === "checking" ? t("checkingLicense") : licenseState === "active" ? t("licenseActivated") : licenseState === "invalid" ? t("licenseInvalid") : ""}
        </p>
      </form>
    </Modal>

    <Modal open={review.open} onClose={() => setReview(value => ({ ...value, open: false }))}>
      <form method="dialog" className="dialog-content"><div className="dialog-icon review">★</div><p className="dialog-eyebrow">{t("batchComplete")}</p>
        <h2>{t("congratsTitle")}</h2><p>{t("congratsMessage", [String(review.removed)])}</p>
        <div className="summary-row"><div className="summary-cell"><strong>{review.removed}</strong><span>{t("summaryRemoved")}</span></div>
          <div className="summary-cell"><strong>{review.remaining}</strong><span>{t("summaryRemaining")}</span></div></div>
        {!review.alreadySeen && <p>{t("reviewDescription")}</p>}
        <div className="dialog-actions">{!review.alreadySeen && <button value="later" className="secondary-button">{t("maybeLater")}</button>}
          <button type={review.alreadySeen ? "submit" : "button"} value="close" className="primary-button" style={review.alreadySeen ? { gridColumn: "1 / -1" } : undefined}
            onClick={async () => { if (review.alreadySeen) return; await chrome.storage.local.set({ [VAULT.reviewSeen]: true }); await askWorker({ type: BRIDGE.launchReview }); setReview(value => ({ ...value, open: false })); }}>
            {review.alreadySeen ? t("close") : t("leaveReview")}
          </button></div>
      </form>
    </Modal>
  </>;
}
