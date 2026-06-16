"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import PropTypes from "prop-types";
import { Modal, Button } from "@/shared/components";

const POLL_INTERVAL_MS = 2000;
const MAX_POLLS = 150;
const SESSION_NOT_FOUND_RETRIES = 5;

export default function ZaiOAuthModal({ isOpen, providerInfo, onSuccess, onClose }) {
  const [step, setStep] = useState("idle");
  const [flowId, setFlowId] = useState(null);
  const [authorizeUrl, setAuthorizeUrl] = useState(null);
  const [error, setError] = useState(null);
  const pollCountRef = useRef(0);
  const pollTimerRef = useRef(null);
  const initAbortRef = useRef(null);
  const activeFlowIdRef = useRef(null);
  const sessionMissRef = useRef(0);

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    pollCountRef.current = 0;
  }, []);

  const resetInternal = useCallback(() => {
    initAbortRef.current?.abort();
    initAbortRef.current = null;
    activeFlowIdRef.current = null;
    sessionMissRef.current = 0;
    stopPolling();
    setStep("idle");
    setFlowId(null);
    setAuthorizeUrl(null);
    setError(null);
  }, [stopPolling]);

  const handleClose = useCallback(() => {
    resetInternal();
    onClose?.();
  }, [onClose, resetInternal]);

  const startPoll = useCallback(
    (id) => {
      stopPolling();
      setStep("polling");

      pollTimerRef.current = setInterval(async () => {
        pollCountRef.current += 1;
        if (pollCountRef.current > MAX_POLLS) {
          stopPolling();
          setError("Authorization timed out. Please try again.");
          setStep("error");
          return;
        }

        try {
          const res = await fetch("/api/oauth/zai/poll", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ flowId: id }),
          });
          const data = await res.json();

          if (!res.ok) {
            if (res.status === 404) {
              sessionMissRef.current += 1;
              if (sessionMissRef.current <= SESSION_NOT_FOUND_RETRIES) {
                return;
              }
            }
            stopPolling();
            setError(
              res.status === 404
                ? "OAuth session was lost (server may have restarted). Click Retry to start again."
                : (data.error || "Polling failed")
            );
            setStep("error");
            return;
          }

          sessionMissRef.current = 0;

          if (data.status === "pending") return;

          if (data.status === "failed") {
            stopPolling();
            setError(data.error || "Authorization failed");
            setStep("error");
            return;
          }

          if (data.status === "ready") {
            stopPolling();
            setStep("success");
            setTimeout(() => {
              onSuccess?.();
              handleClose();
            }, 1500);
          }
        } catch (err) {
          // Ignore transient network errors during polling
          if (pollCountRef.current > MAX_POLLS) {
            stopPolling();
            setError(err.message);
            setStep("error");
          }
        }
      }, POLL_INTERVAL_MS);
    },
    [handleClose, onSuccess, stopPolling]
  );

  const startOAuth = useCallback(async () => {
    initAbortRef.current?.abort();
    const abortController = new AbortController();
    initAbortRef.current = abortController;
    sessionMissRef.current = 0;
    setError(null);
    setStep("init");

    try {
      const res = await fetch("/api/oauth/zai/init", {
        method: "POST",
        signal: abortController.signal,
      });
      const data = await res.json();

      if (abortController.signal.aborted) return;

      if (!res.ok) {
        throw new Error(data.error || "Failed to start OAuth");
      }

      activeFlowIdRef.current = data.flowId;
      setFlowId(data.flowId);
      setAuthorizeUrl(data.authorizeUrl);
      setStep("authorize");
      startPoll(data.flowId);
    } catch (err) {
      if (abortController.signal.aborted) return;
      setError(err.message);
      setStep("error");
    }
  }, [startPoll]);

  useEffect(() => {
    if (!isOpen) {
      resetInternal();
      return undefined;
    }

    startOAuth();

    return () => {
      initAbortRef.current?.abort();
      stopPolling();
    };
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  const openAuthorizeUrl = () => {
    if (authorizeUrl) {
      window.open(authorizeUrl, "_blank", "noopener,noreferrer");
    }
  };

  const providerName = providerInfo?.name || "GLM Coding";

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title={`${providerName} — Z.AI OAuth`}>
      <div className="space-y-4">
        {step === "success" ? (
          <div className="text-center py-8">
            <div className="text-6xl mb-4">✅</div>
            <p className="text-lg font-medium text-text-primary">Account connected!</p>
            <p className="text-sm text-text-muted mt-2">Coding Plan credentials saved</p>
          </div>
        ) : step === "error" ? (
          <>
            <div className="p-3 bg-error/10 border border-error/20 rounded-lg">
              <p className="text-sm text-error">{error}</p>
            </div>
            <div className="flex gap-3">
              <Button variant="secondary" onClick={handleClose} fullWidth>
                Cancel
              </Button>
              <Button onClick={startOAuth} fullWidth>
                Retry
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm text-text-muted">
              Sign in with your Z.AI account to connect a Coding Plan subscription. You can add
              multiple accounts and switch between them via priority or round-robin.
            </p>

            {step === "init" && (
              <div className="flex items-center justify-center py-6 gap-2 text-text-muted">
                <span className="animate-spin">⏳</span>
                <span className="text-sm">Initializing OAuth...</span>
              </div>
            )}

            {(step === "authorize" || step === "polling") && (
              <div className="space-y-3">
                <div className="bg-surface-secondary p-4 rounded-lg text-sm space-y-2">
                  <p className="font-medium text-text-primary">Complete authorization in your browser:</p>
                  <ol className="list-decimal list-inside space-y-1 text-text-muted">
                    <li>Click &quot;Open Authorization Page&quot; below</li>
                    <li>Log in and approve access on z.ai</li>
                    <li>Return here — connection completes automatically</li>
                  </ol>
                </div>

                <Button onClick={openAuthorizeUrl} fullWidth icon="open_in_new">
                  Open Authorization Page
                </Button>

                <div className="flex items-center justify-center gap-2 text-text-muted py-2">
                  <span className="animate-spin text-xs">⏳</span>
                  <span className="text-xs">Waiting for authorization...</span>
                </div>
              </div>
            )}

            <Button variant="secondary" onClick={handleClose} fullWidth>
              Cancel
            </Button>
          </>
        )}
      </div>
    </Modal>
  );
}

ZaiOAuthModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  providerInfo: PropTypes.object,
  onSuccess: PropTypes.func,
  onClose: PropTypes.func,
};