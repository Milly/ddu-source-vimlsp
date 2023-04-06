import { echo } from "https://deno.land/x/denops_std@v4.1.1/helper/mod.ts";
import type { Denops } from "https://deno.land/x/denops_std@v4.1.1/mod.ts";
import { echowindow } from "https://deno.land/x/denops_backport@v2.0.0/mod.ts";

export const safeEcho = async (
  denops: Denops,
  message: string,
  opt?: { error?: boolean },
): Promise<void> => {
  const { error = false } = opt ?? {};
  try {
    const formatted = `(${denops.name}) ${message}`;
    if (error) {
      await echowindow(denops, formatted, { highlight: "ErrorMsg" });
    } else {
      await echo(denops, formatted);
    }
  } catch (_) {
    console[error ? "error" : "log"](message);
  }
};
