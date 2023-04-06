import {
  deadline,
  DeadlineError,
  deferred,
} from "https://deno.land/std@0.182.0/async/mod.ts";
import {
  fromFileUrl,
  relative,
} from "https://deno.land/std@0.182.0/path/mod.ts";
import { readableStreamFromIterable } from "https://deno.land/std@0.182.0/streams/mod.ts";

import { asynciter } from "https://deno.land/x/asynciter@0.0.15/mod.ts";
import { snakeCase } from "https://deno.land/x/case@2.1.1/mod.ts";
import {
  BaseSource,
  type GatherArguments,
  type OnInitArguments,
} from "https://deno.land/x/ddu_vim@v2.7.0/base/source.ts";
import { type Denops, fn } from "https://deno.land/x/ddu_vim@v2.7.0/deps.ts";
import type { Item } from "https://deno.land/x/ddu_vim@v2.7.0/types.ts";
import { ActionData } from "https://deno.land/x/ddu_kind_file@v0.3.2/file.ts";
import { defer } from "https://deno.land/x/denops_defer@v0.6.0/batch/defer.ts";
import * as lambda from "https://deno.land/x/denops_std@v4.1.1/lambda/mod.ts";

import { safeEcho } from "../ddu-source-vimlsp/echo.ts";
import { getByteLength } from "../ddu-source-vimlsp/encode.ts";
import * as lsp from "../ddu-source-vimlsp/lsp.ts";
import {
  assertIt,
  ensureArray,
  ensureIt,
  ensureObject,
  isNumber,
  isObject,
  isString,
  type Predicate,
} from "../ddu-source-vimlsp/unknownutil.ts";

const DEFAULT_TIMEOUT = 10_000; // [msec]

const DEFAULT_HIGHLIGHT = {
  path: "Directory",
  lineNr: "LineNr",
  word: "Special",
} as const;
type HighlightGroup = Record<keyof typeof DEFAULT_HIGHLIGHT, string>;
type HighlightNames = { [K in keyof HighlightGroup]: `source/${string}/${K}` };

function isPartialHighlightGroup(x: unknown): x is Partial<HighlightGroup> {
  return isObject(
    x,
    (v): v is string => isString(v) && /^[a-zA-Z0-9_]+$/.test(v),
  );
}

const SILENT_VALUES = ["", "silent", "silent!"] as const;
type Silent = typeof SILENT_VALUES[number];

function isSilent(x: unknown): x is Silent {
  return isString(x) && SILENT_VALUES.includes(x as Silent);
}

type Params = {
  method?: lsp.LocationListMethod;
  textDocument?: lsp.TextDocumentIdentifier;
  position?: lsp.Position;
  highlights: Partial<HighlightGroup>;
  silent: Silent;
  timeout: number;
};

type FileItem = Item<ActionData>;

export class Source extends BaseSource<Params> {
  override kind = "file";

  override params(): Params {
    return {
      highlights: {},
      timeout: DEFAULT_TIMEOUT,
      silent: "",
    };
  }

  override async onInit(args: OnInitArguments<Params>): Promise<void> {
    const { denops, sourceParams } = args;
    this.#silent = sourceParams.silent;

    try {
      await denops.call("lsp#enable");
    } catch (e: unknown) {
      this.#echoError("Can not enable vim-lsp. Is it installed?", denops);
      console.error(this.name, e);
      return;
    }

    this.#_initialized = {
      denops,
      highlightNames: Object.fromEntries(
        Object.keys(DEFAULT_HIGHLIGHT).map(
          (name) => [name, `source/${this.name}/${name}`],
        ),
      ) as HighlightNames,
    };
  }

  override gather(args: GatherArguments<Params>): ReadableStream<FileItem[]> {
    const {
      sourceParams: {
        method,
        textDocument,
        position,
        highlights: partialHighlights,
        timeout,
        silent,
      },
    } = args;
    this.#silent = silent;
    assertParameter("method", method, lsp.isLocationListMethod);
    assertParameter("textDocument", textDocument, lsp.isTextDocumentIdentifier);
    assertParameter("position", position, lsp.isPosition);
    assertParameter("highlights", partialHighlights, isPartialHighlightGroup);
    assertParameter("timeout", timeout, isNumber);
    assertParameter("silent", silent, isSilent);
    const highlights = { ...DEFAULT_HIGHLIGHT, ...partialHighlights };

    return readableStreamFromIterable(
      this.#gatherItems(method, textDocument, position, timeout, highlights),
    );
  }

  #silent: Silent = "";

  #_initialized?: {
    denops: Denops;
    highlightNames: HighlightNames;
  };
  get #initialized() {
    if (!this.#_initialized) {
      throw new Error("Plugin is not initialized");
    }
    return this.#_initialized;
  }

  async *#gatherItems(
    method: lsp.LocationListMethod,
    textDocument: lsp.TextDocumentIdentifier,
    position: lsp.Position,
    timeout: number,
    highlights: HighlightGroup,
  ): AsyncIterable<FileItem[]> {
    const { denops } = this.#initialized;

    const path = fromFileUrl(textDocument.uri);
    const winid = await fn.bufwinid(denops, path);
    if (winid < 0) {
      this.#echoError(`Buffer not found: ${path}`);
      return;
    }

    const [{ bufnr, winnr, tabnr }] = await fn.getwininfo(
      denops,
      winid,
    ) as Record<string, number>[];
    const cwd = await fn.getcwd(denops, winnr, tabnr) as string;

    const servers = await this.#getServers(method, bufnr);
    if (servers.length === 0) {
      this.#echoError(`Retrieving ${method} not supported`);
      return;
    }

    const request = this.#createRequest(method, { textDocument, position });

    const sendRequest = async (server: string): Promise<FileItem[]> => {
      try {
        const { result, error } = await this.#sendRequest(
          server,
          request,
          timeout,
        );
        if (error) throw new Error(lsp.getErrorMessage(error));
        return await this.#createItems(
          result as lsp.LocationListResult,
          cwd,
          highlights,
        );
      } catch (e: unknown) {
        const msg = e instanceof DeadlineError
          ? `Timed out in ${timeout} msec`
          : (e as Error)?.message ?? e;
        this.#echoError(`Failed to retrieve ${method} for ${server}: ${msg}`);
        console.error(this.name, e);
      }
      return [];
    };

    this.#echoMessage(`Retrieving ${method}...`);
    let itemCount = 0;
    try {
      yield* asynciter(servers)
        .concurrentUnorderedMap(sendRequest)
        .filter((items) => {
          itemCount += items.length;
          return items.length > 0;
        });
    } catch (_) {
      // stream cancelled, so do nothing
    } finally {
      this.#clearCache();
    }
    if (itemCount > 0) {
      this.#echoMessage(`Retrieved ${method}`);
    } else {
      this.#echoMessage(`No ${method} found`);
    }
  }

  async #getServers(
    method: lsp.LocationListMethod,
    bufnr: number,
  ): Promise<string[]> {
    const { denops } = this.#initialized;
    const servers = await denops.call("lsp#get_allowed_servers", bufnr);
    const capableServers = await fn.filter(
      denops,
      servers,
      `lsp#capabilities#has_${snakeCase(method)}_provider(v:val)`,
    );
    return ensureArray(capableServers, isString);
  }

  #createRequest(
    method: lsp.LocationListMethod,
    params: lsp.TextDocumentPositionParams,
  ): lsp.LocationListRequestMessage | lsp.ReferenceRequestMessage {
    return method === "references"
      ? {
        method: `textDocument/${method}`,
        params: { ...params, context: { includeDeclaration: false } },
      }
      : {
        method: `textDocument/${method}`,
        params,
      };
  }

  async #sendRequest<T extends lsp.RequestMessage>(
    server: string,
    request: T,
    timeout: number,
  ): Promise<lsp.ResponseMessage> {
    const { denops } = this.#initialized;
    const data$ = deferred<unknown>();
    const id = lambda.register(denops, (data: unknown) => data$.resolve(data));
    try {
      await denops.eval(
        "lsp#send_request(server, extend(request," +
          "{'on_notification': {data -> denops#notify(name, id, [data])}}))",
        { server, request, name: denops.name, id },
      );
      const data = await (timeout > 0 ? deadline(data$, timeout) : data$);
      const { response } = ensureObject(data);
      return ensureIt(response, lsp.isResponseMessage);
    } finally {
      lambda.unregister(denops, id);
    }
  }

  async #createItems(
    result: lsp.LocationListResult,
    cwd: string,
    highlights: HighlightGroup,
  ): Promise<FileItem[]> {
    if (result === null) return [];
    const { denops, highlightNames } = this.#initialized;

    const resultAsList = Array.isArray(result) ? result : [result];
    const locations = resultAsList.map((loc): lsp.Location =>
      ("targetUri" in loc)
        ? { uri: loc.targetUri, range: loc.targetSelectionRange }
        : loc
    ).filter(({ uri }) => uri.startsWith("file:///"));

    const pathLocations = await defer(
      denops,
      (helper) =>
        locations.map(({ uri, ...rest }) => {
          const path = fromFileUrl(uri);
          return { bufNr: fn.bufnr(helper, path), path, ...rest };
        }),
    );

    return await Promise.all(
      pathLocations.map(
        async (loc): Promise<FileItem> => {
          const { bufNr, path, range: { start, end } } = loc;

          const relativePath = relative(cwd, path);
          const relativePathLen = getByteLength(relativePath);

          const text = await this.#getBufLine(bufNr, path, start.line);
          const wordPos = getByteLength(text.slice(0, start.character));
          const wordEnd = start.line === end.line ? end.character : Infinity;
          const wordLen = getByteLength(text.slice(start.character, wordEnd));

          // Vim's lineNr and col are 1-based
          const lineNr = start.line + 1;
          const col = getByteLength(text.slice(0, start.character)) + 1;
          const pos = `${lineNr} col ${col}`;
          const posLen = getByteLength(pos);

          return {
            word: `${relativePath}|${pos}|${text}`,
            action: {
              bufNr: bufNr < 0 ? undefined : bufNr,
              path,
              lineNr,
              col,
              text,
            },
            highlights: [
              {
                name: highlightNames.path,
                "hl_group": highlights.path,
                col: 1,
                width: relativePathLen,
              },
              {
                name: highlightNames.lineNr,
                "hl_group": highlights.lineNr,
                col: 1 + relativePathLen + 1,
                width: posLen,
              },
              {
                name: highlightNames.word,
                "hl_group": highlights.word,
                col: 1 + relativePathLen + 1 + posLen + 1 + wordPos,
                width: wordLen,
              },
            ],
          };
        },
      ),
    );
  }

  #_bufLineCache = new Map<`${number}:${number}`, Promise<string>>();
  #getBufLine(bufNr: number, path: string, line: number): Promise<string> {
    const fallback = async () => (await this.#getFile(path)).at(line) ?? "";
    if (bufNr <= 0) return fallback();

    const key = `${bufNr}:${line}` as const;
    const cached = this.#_bufLineCache.get(key);
    if (cached) return cached;

    const { denops } = this.#initialized;
    const text$ = (async () => {
      const lineNr = line + 1;
      const lines = await fn.getbufline(denops, bufNr, lineNr);
      return lines.at(0) ?? fallback();
    })();
    this.#_bufLineCache.set(key, text$);
    return text$;
  }

  #_fileCache = new Map<string, Promise<string[]>>();
  #getFile(path: string): Promise<string[]> {
    const cached = this.#_fileCache.get(path);
    if (cached) return cached;

    const lines$ = (async () => {
      try {
        const text = await Deno.readTextFile(path);
        return text.split(/\r?\n|\r/);
      } catch (_) {
        return [];
      }
    })();
    this.#_fileCache.set(path, lines$);
    return lines$;
  }

  #clearCache(): void {
    this.#_bufLineCache.clear();
    this.#_fileCache.clear();
  }

  #echoMessage(message: string, denops?: Denops): void {
    if (this.#silent !== "") return;
    const formatted = `[${this.name}]: ${message}`;
    safeEcho(denops ?? this.#initialized.denops, formatted);
  }

  #echoError(message: string, denops?: Denops): void {
    if (this.#silent === "silent!") return;
    const formatted = `[${this.name}]: ${message}`;
    safeEcho(denops ?? this.#initialized.denops, formatted, { error: true });
  }
}

function assertParameter<T>(
  name: string,
  value: unknown,
  pred: Predicate<T>,
): asserts value is T {
  const message = `Invalid parameter: ${name}: ${JSON.stringify(value)}`;
  assertIt(value, pred, message);
}
