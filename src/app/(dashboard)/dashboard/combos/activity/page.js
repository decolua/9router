"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  Badge,
  Button,
  Card,
  CardSkeleton,
  Select,
} from "@/shared/components";

function formatTimestamp(value) {
  if (!value) {
    return "Unknown";
  }

  const parsed =
    new Date(value);

  return Number.isNaN(
    parsed.getTime()
  )
    ? String(value)
    : parsed.toLocaleString();
}

function outcomeVariant(outcome) {
  if (
    outcome === "success"
  ) {
    return "success";
  }

  if (
    outcome === "exception" ||
    outcome === "failure"
  ) {
    return "error";
  }

  return "default";
}

function formatDuration(value) {
  const duration =
    Number(value);

  return (
    Number.isFinite(duration) &&
    duration >= 0
  )
    ? `${Math.round(duration)} ms`
    : "—";
}

export default function AutoRoutingActivityPage() {
  const [data, setData] =
    useState(null);

  const [loading, setLoading] =
    useState(true);

  const [refreshing, setRefreshing] =
    useState(false);

  const [error, setError] =
    useState("");

  const [
    classFilter,
    setClassFilter,
  ] = useState("all");

  const [
    outcomeFilter,
    setOutcomeFilter,
  ] = useState("all");

  const loadActivity =
    useCallback(
      async (
        refresh = false
      ) => {
        try {
          const response =
            await fetch(
              "/api/combos/auto/activity",
              {
                cache:
                  "no-store",
              }
            );

          const payload =
            await response.json();

          if (!response.ok) {
            throw new Error(
              payload.error ||
              "Failed to load automatic routing activity"
            );
          }

          setData(payload);

        } catch (
          loadError
        ) {
          setError(
            loadError?.message ||
            "Failed to load automatic routing activity"
          );

        } finally {
          setLoading(false);
          setRefreshing(false);
        }
      },
      []
    );

  useEffect(() => {
    let active = true;

    fetch("/api/combos/auto/activity", {
      cache: "no-store",
    })
      .then(async (response) => {
        const payload = await response.json();

        if (!response.ok) {
          throw new Error(
            payload.error ||
            "Failed to load automatic routing activity"
          );
        }

        return payload;
      })
      .then((payload) => {
        if (active) {
          setData(payload);
        }
      })
      .catch((loadError) => {
        if (active) {
          setError(
            loadError?.message ||
            "Failed to load automatic routing activity"
          );
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, []);

  const events = useMemo(
    () => data?.events || [],
    [data]
  );

  const outcomeOptions =
    useMemo(() => {
      return [
        ...new Set(
          events
            .map(
              (event) =>
                event.outcome
            )
            .filter(Boolean)
        ),
      ].map(
        (outcome) => ({
          value: outcome,
          label: outcome,
        })
      );
    }, [events]);

  const filteredEvents =
    useMemo(() => {
      return events.filter(
        (event) => {
          if (
            classFilter !==
              "all" &&
            event.autoClass !==
              classFilter
          ) {
            return false;
          }

          if (
            outcomeFilter !==
              "all" &&
            event.outcome !==
              outcomeFilter
          ) {
            return false;
          }

          return true;
        }
      );
    }, [
      classFilter,
      events,
      outcomeFilter,
    ]);

  if (loading) {
    return (
      <div className="flex flex-col gap-6">
        <CardSkeleton />
        <CardSkeleton />
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-6 px-1 sm:px-0">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-text-main">
            Auto Routing Activity
          </h2>

          <p className="mt-1 text-sm text-text-muted">
            Read-only metadata from existing C.5 persisted routing feedback. Current authority is chat + fallback and remains bounded by the existing C.5 retention window.
          </p>
        </div>

        <Button
          icon="refresh"
          variant="secondary"
          loading={refreshing}
          onClick={() => {
            setRefreshing(true);
            setError("");
            loadActivity(true);
          }}
        >
          Refresh
        </Button>
      </div>

      {error && (
        <Card>
          <div className="flex items-center gap-3 text-red-500">
            <span className="material-symbols-outlined">
              error
            </span>
            <span className="text-sm">
              {error}
            </span>
          </div>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        <Card
          title="Feedback Events"
          icon="history"
        >
          <p className="text-2xl font-semibold text-text-main">
            {data?.count ??
              events.length}
          </p>
          <p className="mt-1 text-xs text-text-muted">
            Metadata only
          </p>
        </Card>

        <Card
          title="Storage Authority"
          icon="database"
        >
          <p className="text-sm font-semibold text-text-main">
            {data
              ?.source
              ?.storage ||
              "existing-c5-routing-feedback"}
          </p>

          <p className="mt-1 text-xs text-text-muted">
            {data
              ?.source
              ?.persistence ||
              "read-only"}
          </p>
        </Card>

        <Card
          title="Scope"
          icon="route"
        >
          <div className="flex flex-wrap gap-2">
            <Badge variant="primary">
              {data
                ?.source
                ?.routeKind ||
                "chat"}
            </Badge>

            <Badge variant="default">
              {data
                ?.source
                ?.strategy ||
                "fallback"}
            </Badge>
          </div>
        </Card>
      </div>

      <Card>
        <div className="grid gap-3 md:grid-cols-2">
          <Select
            label="Auto class"
            value={classFilter}
            onChange={(event) =>
              setClassFilter(
                event.target.value
              )
            }
            options={[
              {
                value: "all",
                label:
                  "All auto classes",
              },
              ...(
                data
                  ?.classes ||
                []
              ).map(
                (entry) => ({
                  value:
                    entry.className,
                  label:
                    entry.token,
                })
              ),
            ]}
          />

          <Select
            label="Outcome"
            value={outcomeFilter}
            onChange={(event) =>
              setOutcomeFilter(
                event.target.value
              )
            }
            options={[
              {
                value: "all",
                label:
                  "All outcomes",
              },
              ...outcomeOptions,
            ]}
          />
        </div>
      </Card>

      <Card
        title={`Recent activity (${filteredEvents.length})`}
        icon="timeline"
      >
        {filteredEvents.length === 0 ? (
          <div className="py-10 text-center text-sm text-text-muted">
            No persisted auto-routing feedback matches the current filter.
          </div>

        ) : (
          <div className="divide-y divide-border-subtle">
            {filteredEvents.map(
              (
                event,
                index
              ) => (
                <div
                  key={`${event.observedAt}-${event.comboName}-${event.candidateModel}-${event.attemptIndex}-${index}`}
                  className="grid gap-3 py-4 xl:grid-cols-[190px_minmax(0,1fr)_auto] xl:items-center"
                >
                  <div>
                    <p className="text-xs font-medium text-text-main">
                      {formatTimestamp(
                        event.observedAt
                      )}
                    </p>

                    <p className="text-[11px] text-text-muted">
                      {event.comboName}
                    </p>
                  </div>

                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-text-main">
                      {
                        event.candidateModel
                      }
                    </p>

                    <p className="mt-1 text-xs text-text-muted">
                      Attempt{" "}
                      {event.attemptIndex ??
                        "—"}
                      /
                      {event.attemptCount ??
                        "—"}

                      {event.status !=
                      null
                        ? ` · HTTP ${event.status}`
                        : ""}

                      {` · ${formatDuration(
                        event.durationMs
                      )}`}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 xl:justify-end">
                    <Badge
                      variant={
                        outcomeVariant(
                          event.outcome
                        )
                      }
                    >
                      {event.outcome ||
                        "unknown"}
                    </Badge>

                    {event.fallbackEligible && (
                      <Badge variant="warning">
                        Fallback
                      </Badge>
                    )}
                  </div>
                </div>
              )
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
