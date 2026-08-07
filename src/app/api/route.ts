import { NextResponse } from "next/server";

/**
 * Health check.
 *
 * This returned `{"message":"Hello, world!"}` — scaffolding from the first commit, live
 * on a public URL of an app about to be reviewed. It is a useful path to keep, so it
 * answers the question it should: is this deployment up, and which build is it?
 *
 * Deliberately says nothing about the database, any merchant, or any configuration. An
 * unauthenticated endpoint that reports internal state is a reconnaissance tool.
 */
export async function GET() {
  return NextResponse.json({
    service: "reviewmaster",
    status: "ok",
    time: new Date().toISOString(),
  });
}
