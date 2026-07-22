"use client";

import { useUser } from "@clerk/nextjs";
import { useAction, useQuery } from "convex/react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { AccountControls } from "@/components/AccountControls";
import { Section } from "@/components/Section";
import { api } from "@/convex/_generated/api";

const focusRing =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-action-dark";

// Same live-region discipline as the setup page: two always-mounted sr-only
// regions, clear-then-set on the next frame so a repeated message
// re-announces (React won't re-fire an unchanged text node).
function useAnnouncer() {
  const [politeStatus, setPolite] = useState("");
  const [errorStatus, setError] = useState("");

  const announce = useCallback((setter: (value: string) => void, message: string) => {
    setter("");
    requestAnimationFrame(() => requestAnimationFrame(() => setter(message)));
  }, []);

  const announcePolite = useCallback((message: string) => announce(setPolite, message), [announce]);
  const announceError = useCallback((message: string) => announce(setError, message), [announce]);

  return { politeStatus, errorStatus, announcePolite, announceError };
}

// Maps the beginLink refusal codes to plain language. The host is echoed
// back so "which server did it try" never needs guessing.
function beginErrorMessage(reason: string, host: string) {
  if (reason === "invalid_host") {
    return "That doesn't look like a server address. Enter something like mastodon.social.";
  }
  if (reason === "instance_unreachable") {
    return `${host || "That server"} did not answer. Check the spelling, or try again in a moment.`;
  }
  if (reason === "not_a_mastodon_server") {
    return `${host || "That server"} did not answer as a Mastodon server. Check the address of the server where your account lives.`;
  }
  return "Something went wrong starting the authorization. Try again in a moment.";
}

export function FreightFateMastodonClient() {
  const { isLoaded, isSignedIn } = useUser();
  const regionRef = useRef<HTMLDivElement>(null);
  const previousSignedIn = useRef(isSignedIn);
  const accountStatus = !isLoaded ? "Loading your account…" : isSignedIn ? "" : "Sign in required.";

  useEffect(() => {
    const justSignedIn = isSignedIn === true && previousSignedIn.current === false;
    previousSignedIn.current = isSignedIn;
    if (justSignedIn) {
      regionRef.current?.focus();
    }
  }, [isSignedIn]);

  return <>
    <div aria-atomic="true" className="sr-only" role="status">{accountStatus}</div>
    {!isLoaded ? (
      <Section title="Your Mastodon link">
        <p>Loading your account…</p>
      </Section>
    ) : !isSignedIn ? (
      <Section title="Sign in to continue">
        <p>
          Mastodon links belong to your orinks.net driver. Sign in with the same account you used
          for Freight Fate online setup.
        </p>
        <AccountControls />
      </Section>
    ) : (
      <div aria-label="Mastodon link" ref={regionRef} role="region" tabIndex={-1}>
        <MastodonLink />
      </div>
    )}
  </>;
}

function OAuthResult({ result, handle }: { result: string; handle: string }) {
  const headingRef = useRef<HTMLHeadingElement>(null);

  // The player lands here straight from the instance's consent screen; put
  // focus on the outcome so it reads without hunting.
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  const heading =
    result === "linked"
      ? "Mastodon account linked"
      : result === "denied"
        ? "Nothing was linked"
        : result === "expired"
          ? "That authorization expired"
          : "The link did not complete";

  return (
    <section
      aria-labelledby="ff-mastodon-result-heading"
      className="space-y-3 rounded border border-line bg-white p-5"
    >
      <h2
        className={`text-xl font-bold text-ink ${focusRing}`}
        id="ff-mastodon-result-heading"
        ref={headingRef}
        tabIndex={-1}
      >
        {heading}
      </h2>
      {result === "linked" ? (
        <>
          <p>
            {handle ? (
              <>
                Your Mastodon account <strong>{handle}</strong> is now linked to your Freight Fate
                driver.
              </>
            ) : (
              <>Your Mastodon account is now linked to your Freight Fate driver.</>
            )}
          </p>
          <p>
            Nothing posts yet: Freight Fate will only post when you turn on Share notable
            deliveries to Mastodon in the game, under Settings, then Online.
          </p>
          <p>You can close this tab and go back to Freight Fate. The game will confirm the link.</p>
        </>
      ) : result === "denied" ? (
        <p>
          You chose not to authorize Freight Fate on your server. Nothing was linked, and nothing
          will be posted. You can start again below whenever you like.
        </p>
      ) : result === "expired" ? (
        <p>
          The authorization took too long or was already used. Start again below to get a fresh
          one.
        </p>
      ) : (
        <p>
          Your server did not finish the authorization. Start again below; if it keeps failing,
          check that your server is online.
        </p>
      )}
    </section>
  );
}

function MastodonLink() {
  const myDriver = useQuery(api.freightFate.getMyDriver);
  const myLink = useQuery(api.freightFateMastodon.getMyMastodonLink);
  const beginLink = useAction(api.freightFateMastodon.beginLink);
  const unlink = useAction(api.freightFateMastodon.unlinkMastodon);
  const { politeStatus, errorStatus, announcePolite, announceError } = useAnnouncer();
  const router = useRouter();
  const searchParams = useSearchParams();

  // The OAuth result lives in state, and the query string is stripped right
  // away: a stale ?result=linked would otherwise replay the panel (and
  // re-steal focus) on every refresh, even after an unlink made it a lie.
  const [result, setResult] = useState(() => searchParams.get("result") ?? "");
  useEffect(() => {
    if (searchParams.get("result")) {
      router.replace("/freight-fate/online/mastodon", { scroll: false });
    }
  }, [router, searchParams]);

  const [instance, setInstance] = useState("");
  const [instanceError, setInstanceError] = useState("");
  const [pending, setPending] = useState(false);
  const [unlinkArmed, setUnlinkArmed] = useState(false);
  const [unlinkPending, setUnlinkPending] = useState(false);
  const instanceRef = useRef<HTMLInputElement>(null);
  const unlinkButtonRef = useRef<HTMLButtonElement>(null);
  const keepLinkRef = useRef<HTMLButtonElement>(null);
  const linkFormHeadingRef = useRef<HTMLHeadingElement>(null);

  // Coming back from the consent screen with the browser's Back button
  // restores this page from bfcache with pending still true, which would
  // leave the submit dead until a manual refresh.
  useEffect(() => {
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) {
        setPending((was) => {
          if (was) {
            announcePolite("Ready to try again.");
          }
          return false;
        });
      }
    };
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, [announcePolite]);

  // Either/or, never both: when focus moves to the field the reader speaks
  // label + invalid + error in one pass, and an alert on top of that would
  // interrupt it; the live region is only for a failure while focus is
  // already sitting in the field (which would otherwise announce nothing).
  const showInstanceError = useCallback(
    (message: string) => {
      setInstanceError(message);
      if (document.activeElement === instanceRef.current) {
        announceError(message);
      } else {
        requestAnimationFrame(() => instanceRef.current?.focus());
      }
    },
    [announceError],
  );

  const submit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      if (pending) {
        return;
      }
      const typed = instance.trim();
      if (!typed) {
        showInstanceError("Enter your Mastodon server first, like mastodon.social.");
        return;
      }
      setPending(true);
      setInstanceError("");
      announcePolite("Connecting to your server…");
      try {
        const outcome = await beginLink({ instanceHost: typed });
        if (outcome.ok) {
          announcePolite("Sending you to your server to authorize Freight Fate.");
          window.location.assign(outcome.authorizeUrl);
          return; // keep the pending label while the browser navigates
        }
        setPending(false);
        showInstanceError(beginErrorMessage(outcome.reason, typed));
      } catch {
        setPending(false);
        showInstanceError("Something went wrong starting the authorization. Try again in a moment.");
      }
    },
    [announcePolite, beginLink, instance, pending, showInstanceError],
  );

  // Two-step confirm, house rules: arming is announced (readers do not
  // re-read a focused button whose text node swapped), and blur or Escape
  // disarms audibly. Escape and "Keep the link" put focus back on the
  // unlink button; a deliberate Tab away is left where the user went.
  const armUnlink = useCallback(() => {
    setUnlinkArmed(true);
    announcePolite(
      "Press again to confirm unlinking your Mastodon account, or choose Keep the link.",
    );
  }, [announcePolite]);

  const disarmUnlink = useCallback(
    (refocus: boolean) => {
      setUnlinkArmed(false);
      announcePolite("Unlink canceled. Your Mastodon link is kept.");
      if (refocus) {
        requestAnimationFrame(() => unlinkButtonRef.current?.focus());
      }
    },
    [announcePolite],
  );

  const confirmUnlink = useCallback(async () => {
    if (unlinkPending) {
      return;
    }
    setUnlinkPending(true);
    try {
      await unlink({});
      setResult("");
      announcePolite("Mastodon account unlinked. Freight Fate can no longer post for you.");
      // The section holding the focused button unmounts with the link; land
      // on the link-form heading instead of letting focus fall to <body>.
      requestAnimationFrame(() => linkFormHeadingRef.current?.focus());
    } catch {
      announceError("Unlinking failed. Try again in a moment.");
    } finally {
      setUnlinkPending(false);
      setUnlinkArmed(false);
    }
  }, [announceError, announcePolite, unlink, unlinkPending]);

  if (myDriver === undefined || myLink === undefined) {
    return (
      <Section title="Your Mastodon link">
        <p>Loading your Mastodon link…</p>
      </Section>
    );
  }

  if (myDriver === null) {
    return (
      <Section title="Set up your driver first">
        <p>
          Mastodon links belong to a Freight Fate driver, and this account does not have one yet.{" "}
          <Link className={focusRing} href="/freight-fate/online/setup">
            Set up your Freight Fate driver
          </Link>{" "}
          first, then come back here.
        </p>
      </Section>
    );
  }

  return (
    <div className="space-y-6 pt-8">
      {/* Always mounted so announcements are never missed. */}
      <div aria-atomic="true" className="sr-only" role="status">
        {politeStatus}
      </div>
      <div aria-atomic="true" className="sr-only" role="alert">
        {errorStatus}
      </div>

      {/* Belt and suspenders with setResult("") on unlink: never show a
          "linked" panel the link table contradicts. */}
      {result && !(result === "linked" && !myLink) ? (
        <OAuthResult handle={myLink?.handle ?? ""} result={result} />
      ) : null}

      <section
        aria-labelledby="ff-mastodon-what-heading"
        className="space-y-3 rounded border border-line bg-white p-5"
      >
        <h2 className="text-xl font-bold text-ink" id="ff-mastodon-what-heading">
          What Freight Fate posts
        </h2>
        <p className="text-slate-800">
          Only notable deliveries: runs that earned you a badge, a driver level, or a perfect
          streak milestone. Each post is a short public summary, like the cargo, the cities, and
          what you earned, and always carries the #FreightFate hashtag so followers can filter it.
          Routine deliveries are never posted, and posting only happens while Share notable
          deliveries to Mastodon is turned on in the game.
        </p>
        <p className="text-slate-800">
          Freight Fate asks your server for permission to post, plus permission to read your
          account name so this page and the game can tell you which account is linked. It cannot
          read your timeline, your messages, or your followers.
        </p>
      </section>

      {myLink ? (
        <section
          aria-labelledby="ff-mastodon-linked-heading"
          className="space-y-3 rounded border border-line bg-white p-5"
        >
          <h2 className="text-xl font-bold text-ink" id="ff-mastodon-linked-heading">
            Your linked account
          </h2>
          <p className="text-slate-800">
            Linked to <strong>{myLink.handle || `your account on ${myLink.instanceHost}`}</strong>.
            To finish up, go back to Freight Fate and turn on Share notable deliveries to Mastodon
            under Settings, then Online.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <button
              aria-disabled={unlinkPending || undefined}
              className={`rounded border border-line-strong px-4 py-2 font-semibold text-ink hover:bg-slate-50 aria-disabled:cursor-not-allowed aria-disabled:opacity-60 ${focusRing}`}
              onBlur={(event) => {
                // Focus heading for the Keep button lets its own click
                // handle the cancel; unmount-after-confirm is a completed
                // action, not a cancel.
                if (unlinkArmed && !unlinkPending && event.relatedTarget !== keepLinkRef.current) {
                  disarmUnlink(false);
                }
              }}
              onClick={() => (unlinkArmed ? void confirmUnlink() : armUnlink())}
              onKeyDown={(event) => {
                // The pending guard keeps Escape during "Unlinking…" from
                // announcing a cancel the in-flight unlink then contradicts.
                if (event.key === "Escape" && unlinkArmed && !unlinkPending) {
                  disarmUnlink(true);
                }
              }}
              ref={unlinkButtonRef}
              type="button"
            >
              {unlinkPending
                ? "Unlinking…"
                : unlinkArmed
                  ? "Confirm: unlink Mastodon"
                  : "Unlink this Mastodon account"}
            </button>
            {unlinkArmed && !unlinkPending ? (
              <button
                className={`rounded px-4 py-2 font-semibold text-ink hover:bg-slate-50 ${focusRing}`}
                onBlur={(event) => {
                  // Tabbing onward from Keep leaves the confirm pair, so it
                  // disarms audibly too; Shift+Tab back to the unlink button
                  // stays mid-pair and keeps the armed state.
                  if (unlinkArmed && event.relatedTarget !== unlinkButtonRef.current) {
                    disarmUnlink(false);
                  }
                }}
                onClick={() => disarmUnlink(true)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    disarmUnlink(true);
                  }
                }}
                ref={keepLinkRef}
                type="button"
              >
                Keep the link
              </button>
            ) : null}
          </div>
          <p className="text-sm text-slate-700">
            Unlinking stops all posting immediately and asks your server to revoke the
            authorization. Linking a different account replaces this one.
          </p>
        </section>
      ) : null}

      <section
        aria-labelledby="ff-mastodon-link-heading"
        className="space-y-4 rounded border border-line bg-white p-5"
      >
        <h2
          className={`text-xl font-bold text-ink ${focusRing}`}
          id="ff-mastodon-link-heading"
          ref={linkFormHeadingRef}
          tabIndex={-1}
        >
          {myLink ? "Link a different account" : "Link your Mastodon account"}
        </h2>
        <form noValidate onSubmit={submit}>
          <div className="space-y-2">
            <label className="block font-semibold text-ink" htmlFor="ff-mastodon-instance">
              Mastodon server
            </label>
            <p className="text-sm text-slate-600" id="ff-mastodon-instance-hint">
              The address of the server where your account lives, for example mastodon.social. You
              can also paste your full profile address.
            </p>
            <input
              aria-describedby={
                instanceError
                  ? "ff-mastodon-instance-error ff-mastodon-instance-hint"
                  : "ff-mastodon-instance-hint"
              }
              aria-invalid={instanceError ? true : undefined}
              autoCapitalize="none"
              autoComplete="off"
              className="w-full rounded border border-line-strong px-3 py-2 text-ink sm:max-w-md"
              id="ff-mastodon-instance"
              onChange={(event) => setInstance(event.target.value)}
              ref={instanceRef}
              spellCheck={false}
              type="text"
              value={instance}
            />
            {instanceError ? (
              <p className="text-sm text-red-700" id="ff-mastodon-instance-error">
                {instanceError}
              </p>
            ) : null}
          </div>
          <button
            aria-disabled={pending || undefined}
            className={`mt-4 rounded bg-action px-4 py-2 font-semibold text-white hover:bg-action-dark aria-disabled:cursor-not-allowed aria-disabled:opacity-60 ${focusRing}`}
            type="submit"
          >
            {pending ? "Connecting to your server…" : "Continue to your Mastodon server to authorize"}
          </button>
        </form>
        <p className="text-sm text-slate-700">
          Your server will show exactly what Freight Fate is asking for before you approve
          anything. Afterward it sends you back here, and this page will tell you how it went.
        </p>
      </section>
    </div>
  );
}
