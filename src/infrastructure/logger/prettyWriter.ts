/**
 * Minimal inline pretty-printer for pino.
 * Replaces pino-pretty to avoid worker-thread issues in compiled exe.
 */

const LEVELS: Record<number, string> = {
  10: "TRACE",
  20: "DEBUG",
  30: "INFO",
  40: "WARN",
  50: "ERROR",
  60: "FATAL",
};

export function prettyWriter(): (line: string) => string {
  return (line: string) => {
    try {
      const obj = JSON.parse(line);
      const level = LEVELS[obj.level as number] ?? "UNKNOWN";
      let time = obj.time as string;
      // pino timestamp is milliseconds since epoch; format as HH:MM:SS
      if (typeof time === "number") {
        const d = new Date(time);
        time = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
      }
      const msg = (obj.msg as string) ?? "";
      // colour based on level
      const colour = level === "ERROR" || level === "FATAL" ? "\x1b[31m"
        : level === "WARN" ? "\x1b[33m"
        : level === "INFO" ? "\x1b[32m"
        : level === "DEBUG" ? "\x1b[90m"
        : "\x1b[0m";
      const reset = "\x1b[0m";
      return `${colour}[${time}] ${level}: ${msg}${reset}`;
    } catch {
      return line;
    }
  };
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}
