import { batch } from "https://deno.land/x/denops_std@v4.1.0/batch/mod.ts";
import { execute } from "https://deno.land/x/denops_std@v4.1.0/function/mod.ts";
import {
  echo,
  echoerr,
} from "https://deno.land/x/denops_std@v4.1.0/helper/mod.ts";
import type { Denops } from "https://deno.land/x/denops_std@v4.1.0/mod.ts";
import { generateUniqueString } from "https://deno.land/x/denops_std@v4.1.0/util.ts";

const echowindowCacheKey = Symbol("ddu-source-vimlsp/echo");

const prepareEchowindow = async (denops: Denops): Promise<string> => {
  if (typeof denops.context[echowindowCacheKey] === "string") {
    return denops.context[echowindowCacheKey];
  }
  const suffix = generateUniqueString();
  denops.context[echowindowCacheKey] = suffix;
  const script = `
  function! DduSourceVimlsp_echowindow_${suffix}(message, highlight) abort
    if !empty(a:highlight) | execute 'echohl' a:highlight | endif
    try
      echowindow a:message
    catch
      echomsg a:message
    endtry
    if !empty(a:highlight) | echohl None | endif
  endfunction
  `;
  await execute(denops, script);
  return suffix;
};

export const echowindow = async (
  denops: Denops,
  message: string,
  opt?: { highlight: string },
): Promise<void> => {
  const { highlight = "" } = opt ?? {};
  await batch(denops, async (helper) => {
    const suffix = await prepareEchowindow(helper);
    await helper.call(
      `DduSourceVimlsp_echowindow_${suffix}`,
      message,
      highlight,
    );
  });
};

export const safeEcho = async (
  denops: Denops,
  message: string,
  opt?: { error?: boolean },
): Promise<void> => {
  const { error = false } = opt ?? {};
  try {
    const formatted = `(${denops.name}) ${message}`;
    if (error) {
      await batch(denops, async (helper) => {
        await echowindow(helper, formatted, { highlight: "ErrorMsg" });
        await echoerr(helper, formatted);
      });
    } else {
      await echo(denops, formatted);
    }
  } catch (_) {
    console[error ? "error" : "log"](message);
  }
};
