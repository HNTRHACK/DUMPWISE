"use client";

import { useMemo, useState } from "react";
import { api } from "@/lib/api/client";
import { currenciesOf, defaultCurrency, monthsBetween, seriesFor, summarize } from "@/lib/analytics/monthly";
import { useResource } from "@/lib/use-resource";
import { useWorkspace } from "./workspace-provider";

/**
 * Fetches GET /v1/sales/monthly for the active organization and the selected completed-month
 * range (the backend filters with ?from=&to=). The user picks ONE currency at a time.
 */
export function useMonthlySales() {
  const { organization, range } = useWorkspace();
  const orgId = organization.organizationId;
  const resource = useResource(`${orgId}|${range.from}|${range.to}`, (signal) => api.monthlySales(orgId, range, signal));
  const rows = useMemo(() => resource.data?.months ?? [], [resource.data]);
  const currencies = useMemo(() => currenciesOf(rows), [rows]);
  const [chosen, setCurrency] = useState<string | null>(null);
  const currency = chosen && currencies.includes(chosen) ? chosen : defaultCurrency(rows);
  const months = useMemo(() => monthsBetween(range.from, range.to), [range.from, range.to]);
  const series = useMemo(() => (currency ? seriesFor(rows, currency, months) : []), [rows, currency, months]);
  const summary = useMemo(() => (currency ? summarize(series, currency) : null), [series, currency]);
  return { resource, rows, currencies, currency, setCurrency, series, summary, range };
}
