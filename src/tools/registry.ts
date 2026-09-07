import type { Config } from "../config.js";
import { authStatus } from "./auth.js";
import { doctor } from "./doctor.js";
import type { ToolDef } from "./define.js";
import { login } from "./login.js";
import { getOrder, listOrders, searchProducts } from "./orders.js";
import { installmentsSchedule, spendingSummary } from "./analytics.js";
import { downloadInvoice, getInvoice } from "./invoices.js";
import { exportData } from "./export.js";
import { sync } from "./sync.js";
import { rawGet } from "./raw.js";

// The single list of tools, shared by the MCP server and the CLI so the two
// surfaces cannot drift. Array order is the order clients see.

export const allTools: ToolDef[] = [
  // Session and diagnostics
  authStatus,
  login,
  doctor,
  // Cache
  sync,
  // Orders
  listOrders,
  getOrder,
  searchProducts,
  // Analytics
  spendingSummary,
  installmentsSchedule,
  // Invoices
  getInvoice,
  downloadInvoice,
  // Files
  exportData,
  // Escape hatch
  rawGet,
];

/**
 * Read-only mode removes the writing tools from the REGISTRY, so they are
 * absent rather than "refused at call time" — a structural guarantee instead of
 * an `if` somebody can forget.
 */
export function activeTools(config: Pick<Config, "readOnly">): ToolDef[] {
  return config.readOnly ? allTools.filter((tool) => tool.readOnly) : allTools;
}

export function toolByName(name: string): ToolDef | undefined {
  return allTools.find((tool) => tool.name === name);
}
