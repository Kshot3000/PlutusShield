import { openDataResponse } from "@/lib/openData";

export const dynamic = "force-static";

export function GET() {
  return openDataResponse("oracle");
}
