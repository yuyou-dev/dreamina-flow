import { writeRuntimeLog } from "./logger.js";
import { createApp } from "./app.js";

const port = Number(process.env.PORT ?? 3100);

function serializeReason(reason: unknown) {
  if (reason instanceof Error) {
    return {
      message: reason.message,
      stack: reason.stack,
      name: reason.name,
    };
  }
  return { message: String(reason) };
}

process.on("unhandledRejection", (reason) => {
  const payload = serializeReason(reason);
  void writeRuntimeLog("error", "process.unhandledRejection", payload).catch(() => undefined);
  console.error("Unhandled rejection:", reason);
});

process.on("uncaughtException", (error) => {
  const payload = serializeReason(error);
  void writeRuntimeLog("error", "process.uncaughtException", payload)
    .catch(() => undefined)
    .finally(() => {
      console.error("Uncaught exception:", error);
      process.exit(1);
    });
});

createApp()
  .then((app) => {
    app.listen(port, "0.0.0.0", () => {
      console.log(`Workflow Studio API listening on http://0.0.0.0:${port}`);
    });
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
