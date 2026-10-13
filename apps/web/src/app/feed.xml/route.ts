import { activityFeedXml } from "@/lib/activityFeed";

export const dynamic = "force-static";

export function GET() {
  return new Response(activityFeedXml(), {
    headers: { "content-type": "application/atom+xml; charset=utf-8" },
  });
}
