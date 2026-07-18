import { StudyRequestError, processStudyUpload } from "../../../lib/server/studyUpload";
import type { StudyErrorPayload } from "../../../lib/studyTypes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function errorResponse(status: number, code: string, message: string): Response {
  return Response.json({ code, message } satisfies StudyErrorPayload, {
    status,
    headers: { "Cache-Control": "no-store" }
  });
}

export async function POST(request: Request): Promise<Response> {
  try {
    const formData = await request.formData();
    const kindEntry = formData.get("kind");
    const files = formData
      .getAll("files")
      .filter((entry): entry is File => typeof entry !== "string" && typeof entry.name === "string");
    const payload = await processStudyUpload(typeof kindEntry === "string" ? kindEntry : "", files);

    return Response.json(payload, {
      status: 200,
      headers: { "Cache-Control": "no-store" }
    });
  } catch (error) {
    if (error instanceof StudyRequestError) {
      return errorResponse(error.status, error.code, error.message);
    }
    return errorResponse(500, "SERVER_ERROR", "The server could not process this study.");
  }
}
