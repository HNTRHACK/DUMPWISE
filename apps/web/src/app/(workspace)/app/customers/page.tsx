import type { Metadata } from "next";
import { ComingNext } from "@/components/dashboard/coming-next";

export const metadata: Metadata = { title: "Customers" };

const DTO = `{
  organizationId: string (uuid),
  currency: string,          // one currency per request, no FX
  from: "YYYY-MM", to: "YYYY-MM",
  total: number, limit: number, offset: number,
  items: [{
    code: string,              // SAP identifier, leading zeros preserved
    name: string | null,
    netSales: string,        // decimal string
    transactionCount: number,
    unitsSold: [{ unit: string, quantity: string }]
  }]
}`;

export default function Page() {
  return <ComingNext title="Customers" purpose="End-customer (SAP ship-to party) sales analysis." endpoint="GET /v1/sales/by-customer?from=YYYY-MM&to=YYYY-MM&currency=INR&limit=50&offset=0" dto={DTO} />;
}
