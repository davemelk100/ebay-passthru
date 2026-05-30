import pino from "pino";
import { env } from "./env.js";

// Cloud Logging recognizes `severity` and treats `message` as the primary
// log line. Mapping pino levels to severity gets us correct categorization
// in Error Reporting (errors/warnings) without extra setup.
const isProd = env.NODE_ENV === "production";

export const log = pino({
  level: env.LOG_LEVEL,
  messageKey: "message",
  formatters: {
    level: (label) => ({ severity: label.toUpperCase() }),
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  ...(isProd
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: { colorize: true, translateTime: "HH:MM:ss.l" },
        },
      }),
});
