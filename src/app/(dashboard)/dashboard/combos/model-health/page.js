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
  Input,
  Select,
} from "@/shared/components";

function normalizedHealth(model) {
  const status =
    String(
      model?.health?.status ||
      "unknown"
    ).toLowerCase();

  if (
    status === "healthy" ||
    status === "unhealthy"
  ) {
    return status;
  }

  return "unknown";
}

function healthVariant(status) {
  if (status === "healthy") {
    return "success";
  }

  if (status === "unhealthy") {
    return "error";
  }

  return "default";
}

function formatLatency(value) {
  const latency =
    Number(value);

  return (
    Number.isFinite(latency) &&
    latency >= 0
  )
    ? `${Math.round(latency)} ms`
    : "Unknown";
}

function formatTimestamp(value) {
  if (!value) {
    return "Not available";
  }

  const parsed =
    new Date(value);

  return Number.isNaN(
    parsed.getTime()
  )
    ? String(value)
    : parsed.toLocaleString();
}

function enabledCapabilities(model) {
  return Object.entries(
    model?.capabilities ||
    {}
  )
    .filter(
      ([, enabled]) =>
        enabled === true
    )
    .map(
      ([name]) =>
        name
    );
}

export default function ModelHealthPage() {
  const [snapshot, setSnapshot] =
    useState(null);

  const [loading, setLoading] =
    useState(true);

  const [refreshing, setRefreshing] =
    useState(false);

  const [error, setError] =
    useState("");

  const [query, setQuery] =
    useState("");

  const [
    healthFilter,
    setHealthFilter,
  ] = useState("all");

  const loadInventory =
    useCallback(
      async (
        force = false
      ) => {
        try {
          const response =
            await fetch(
              "/api/models/inventory",
              {
                method:
                  force
                    ? "POST"
                    : "GET",

                headers:
                  force
                    ? {
                        "Content-Type":
                          "application/json",
                      }
                    : undefined,

                body:
                  force
                    ? JSON.stringify({
                        force: true,
                        includeDynamic:
                          true,
                        probe: false,
                      })
                    : undefined,

                cache:
                  "no-store",
              }
            );

          const data =
            await response.json();

          if (!response.ok) {
            throw new Error(
              data.error ||
              "Failed to load model inventory"
            );
          }

          setSnapshot(data);

        } catch (
          loadError
        ) {
          setError(
            loadError?.message ||
            "Failed to load model inventory"
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

    fetch("/api/models/inventory", {
      cache: "no-store",
    })
      .then(async (response) => {
        const data = await response.json();

        if (!response.ok) {
          throw new Error(
            data.error ||
            "Failed to load model inventory"
          );
        }

        return data;
      })
      .then((data) => {
        if (active) {
          setSnapshot(data);
        }
      })
      .catch((loadError) => {
        if (active) {
          setError(
            loadError?.message ||
            "Failed to load model inventory"
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

  const providersById =
    useMemo(() => {
      return new Map(
        (
          snapshot
            ?.providers ||
          []
        ).map(
          (provider) => [
            provider.providerId,
            provider,
          ]
        )
      );
    }, [snapshot]);

  const models = useMemo(
    () => snapshot?.models || [],
    [snapshot]
  );

  const counts =
    useMemo(() => {
      return models.reduce(
        (
          result,
          model
        ) => {
          result[
            normalizedHealth(
              model
            )
          ] += 1;

          return result;
        },
        {
          healthy: 0,
          unhealthy: 0,
          unknown: 0,
        }
      );
    }, [models]);

  const filteredModels =
    useMemo(() => {
      const normalizedQuery =
        query
          .trim()
          .toLowerCase();

      return models.filter(
        (model) => {
          const status =
            normalizedHealth(
              model
            );

          if (
            healthFilter !==
              "all" &&
            status !==
              healthFilter
          ) {
            return false;
          }

          if (
            !normalizedQuery
          ) {
            return true;
          }

          return [
            model.providerId,
            model.modelId,
            model.canonicalId,
            model.displayName,
          ]
            .filter(Boolean)
            .some(
              (value) =>
                String(value)
                  .toLowerCase()
                  .includes(
                    normalizedQuery
                  )
            );
        }
      );
    }, [
      healthFilter,
      models,
      query,
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
            Model Health
          </h2>
          <p className="mt-1 text-sm text-text-muted">
            Read-only C.6.2 inventory health and eligibility. Refresh updates discovery only and does not run probes.
          </p>
        </div>

        <Button
          icon="refresh"
          variant="secondary"
          loading={refreshing}
          onClick={() => {
            setRefreshing(true);
            setError("");
            loadInventory(true);
          }}
        >
          Refresh Inventory
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

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card
          title="Models"
          icon="model_training"
        >
          <p className="text-2xl font-semibold text-text-main">
            {snapshot?.modelCount ??
              models.length}
          </p>
          <p className="mt-1 text-xs text-text-muted">
            Refreshed{" "}
            {formatTimestamp(
              snapshot?.refreshedAt
            )}
          </p>
        </Card>

        <Card
          title="Healthy"
          icon="check_circle"
        >
          <p className="text-2xl font-semibold text-green-600 dark:text-green-400">
            {counts.healthy}
          </p>
        </Card>

        <Card
          title="Unhealthy"
          icon="error"
        >
          <p className="text-2xl font-semibold text-red-500">
            {counts.unhealthy}
          </p>
        </Card>

        <Card
          title="Unknown"
          icon="help"
        >
          <p className="text-2xl font-semibold text-text-main">
            {counts.unknown}
          </p>
        </Card>
      </div>

      <Card>
        <div className="grid gap-3 md:grid-cols-[1fr_220px]">
          <Input
            label="Search models"
            icon="search"
            value={query}
            onChange={(event) =>
              setQuery(
                event.target.value
              )
            }
            placeholder="Provider, model, or canonical ID"
          />

          <Select
            label="Health"
            value={healthFilter}
            onChange={(event) =>
              setHealthFilter(
                event.target.value
              )
            }
            options={[
              {
                value: "all",
                label:
                  "All health states",
              },
              {
                value: "healthy",
                label: "Healthy",
              },
              {
                value:
                  "unhealthy",
                label:
                  "Unhealthy",
              },
              {
                value: "unknown",
                label: "Unknown",
              },
            ]}
          />
        </div>
      </Card>

      <Card
        title={`Inventory (${filteredModels.length})`}
        icon="database"
      >
        {filteredModels.length === 0 ? (
          <div className="py-8 text-center text-sm text-text-muted">
            No models match the current filter.
          </div>

        ) : (
          <div className="divide-y divide-border-subtle">
            {filteredModels.map(
              (model) => {
                const status =
                  normalizedHealth(
                    model
                  );

                const provider =
                  providersById.get(
                    model.providerId
                  );

                const capabilities =
                  enabledCapabilities(
                    model
                  );

                return (
                  <div
                    key={
                      model.canonicalId
                    }
                    className="grid gap-3 py-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(220px,1fr)_minmax(260px,1fr)] xl:items-center"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-text-main">
                        {model.providerId}/
                        {model.modelId}
                      </p>

                      <p className="truncate text-[11px] text-text-muted">
                        {model.canonicalId}
                      </p>

                      {model.displayName &&
                        model.displayName !==
                          model.modelId && (
                          <p className="truncate text-xs text-text-muted">
                            {
                              model.displayName
                            }
                          </p>
                        )}
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <Badge
                        variant={
                          healthVariant(
                            status
                          )
                        }
                        dot
                      >
                        {status}
                      </Badge>

                      <span className="text-xs text-text-muted">
                        {formatLatency(
                          model
                            ?.health
                            ?.latencyMs
                        )}
                      </span>

                      <Badge
                        variant={
                          model
                            .llmRoutingEligible
                            ? "success"
                            : "default"
                        }
                        size="sm"
                      >
                        LLM{" "}
                        {model
                          .llmRoutingEligible
                          ? "Eligible"
                          : "Excluded"}
                      </Badge>

                      <Badge
                        variant={
                          model
                            .autoModelEligible
                            ? "primary"
                            : "default"
                        }
                        size="sm"
                      >
                        Model Auto{" "}
                        {model
                          .autoModelEligible
                          ? "On"
                          : "Off"}
                      </Badge>

                      {provider && (
                        <>
                          <Badge
                            variant={
                              provider
                                .autoModelEligible
                                ? "primary"
                                : "default"
                            }
                            size="sm"
                          >
                            Provider Auto{" "}
                            {provider
                              .autoModelEligible
                              ? "On"
                              : "Off"}
                          </Badge>

                          {provider.connectionless && (
                            <Badge
                              variant="info"
                              size="sm"
                            >
                              Connectionless
                            </Badge>
                          )}
                        </>
                      )}
                    </div>

                    <div className="flex flex-wrap gap-1.5">
                      {capabilities.length === 0 ? (
                        <Badge
                          variant="default"
                          size="sm"
                        >
                          No classified capability
                        </Badge>

                      ) : (
                        capabilities.map(
                          (
                            capability
                          ) => (
                            <Badge
                              key={
                                capability
                              }
                              variant="default"
                              size="sm"
                            >
                              {
                                capability
                              }
                            </Badge>
                          )
                        )
                      )}
                    </div>
                  </div>
                );
              }
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
