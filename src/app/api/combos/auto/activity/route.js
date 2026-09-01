import {
  NextResponse,
} from "next/server";

import {
  AUTO_COMBO_CLASSES,
} from "@/lib/autoCombo/generator.js";

import {
  loadPersistedRoutingFeedbackEvents,
} from "@/lib/db/repos/routingFeedbackRepo.js";

export const dynamic =
  "force-dynamic";

const MAX_EVENTS_PER_CLASS =
  64;

const MAX_EVENTS_TOTAL =
  256;

export async function GET() {
  try {
    const rowsByClass =
      await Promise.all(
        AUTO_COMBO_CLASSES.map(
          async (
            className
          ) => {
            const comboName =
              `auto::${className}`;

            const rows =
              await loadPersistedRoutingFeedbackEvents({
                comboName,
                routeKind:
                  "chat",
                strategy:
                  "fallback",
                limit:
                  MAX_EVENTS_PER_CLASS,
              });

            return rows.map(
              (event) => ({
                observedAt:
                  event.observedAt,

                autoClass:
                  className,

                comboName:
                  event.comboName,

                candidateModel:
                  event.candidateModel,

                attemptIndex:
                  event.attemptIndex,

                attemptCount:
                  event.attemptCount,

                outcome:
                  event.outcome,

                status:
                  event.status,

                fallbackEligible:
                  event.fallbackEligible,

                durationMs:
                  event.durationMs,
              })
            );
          }
        )
      );

    const events =
      rowsByClass
        .flat()
        .sort(
          (a, b) =>
            Date.parse(
              b.observedAt ||
              0
            ) -
            Date.parse(
              a.observedAt ||
              0
            )
        )
        .slice(
          0,
          MAX_EVENTS_TOTAL
        );

    return NextResponse.json({
      version: 1,

      generatedAt:
        new Date()
          .toISOString(),

      source: {
        storage:
          "existing-c5-routing-feedback",

        routeKind:
          "chat",

        strategy:
          "fallback",

        persistence:
          "read-only",

        retention:
          "existing-c5-bounded",
      },

      classes:
        AUTO_COMBO_CLASSES.map(
          (className) => ({
            className,
            token:
              `auto::${className}`,
          })
        ),

      count:
        events.length,

      events,
    });

  } catch (error) {
    console.error(
      "[C6.5][auto-routing-activity] GET failed:",
      error
    );

    return NextResponse.json(
      {
        error:
          "Failed to load automatic routing activity",
      },
      {
        status: 500,
      }
    );
  }
}
