import { NextResponse } from "next/server";
import { callTradingApi } from "@/lib/ebay";
import { requireEbayConfig } from "@/lib/api-guards";
import { asArray, getResponse } from "@/lib/ebay-xml";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Returns the list of Platform Notification event types currently
// enabled on the seller account, plus the Application URL eBay is
// supposed to deliver to. Read-only — calls GetNotificationPreferences
// against the Trading API.
export async function GET() {
  const guard = requireEbayConfig({ okFlag: true });
  if (guard.response) return guard.response;
  const { cfg } = guard;

  const started = Date.now();

  const [appResult, userResult] = await Promise.all([
    callTradingApi(
      "GetNotificationPreferences",
      "<PreferenceLevel>Application</PreferenceLevel>",
      cfg,
    ),
    callTradingApi(
      "GetNotificationPreferences",
      "<PreferenceLevel>User</PreferenceLevel>",
      cfg,
    ),
  ]);

  const appResp = getResponse(appResult.parsed, "GetNotificationPreferencesResponse") as
    | Record<string, unknown>
    | undefined;
  const userResp = getResponse(userResult.parsed, "GetNotificationPreferencesResponse") as
    | Record<string, unknown>
    | undefined;

  const appPrefs = appResp?.ApplicationDeliveryPreferences as
    | Record<string, unknown>
    | undefined;

  const userPrefs = asArray<{ EventType?: string; EventEnable?: string }>(
    (userResp?.UserDeliveryPreferenceArray as Record<string, unknown> | undefined)
      ?.NotificationEnable,
  );

  const enabled = userPrefs
    .filter((p) => p.EventEnable === "Enable")
    .map((p) => String(p.EventType ?? ""))
    .filter(Boolean);

  return NextResponse.json({
    ok: true,
    applicationUrl: String(appPrefs?.ApplicationURL ?? ""),
    applicationEnabled: String(appPrefs?.ApplicationEnable ?? "") === "Enable",
    deviceType: String(appPrefs?.DeviceType ?? ""),
    payloadVersion: String(appPrefs?.PayloadVersion ?? ""),
    enabledEvents: enabled,
    durationMs: Date.now() - started,
  });
}
