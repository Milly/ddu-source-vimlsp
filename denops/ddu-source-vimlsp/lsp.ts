import { isLike, isObject, isString, isUndefined } from "./unknownutil.ts";

export type DocumentUri = string;

export interface TextDocumentIdentifier {
  uri: DocumentUri;
}

export function isTextDocumentIdentifier(
  x: unknown,
): x is TextDocumentIdentifier {
  return isLike({ uri: "x" } as TextDocumentIdentifier, x);
}

export interface Position {
  line: number;
  character: number;
}

export function isPosition(x: unknown): x is Position {
  return isLike({ line: 1, character: 1 } as Position, x);
}

export interface Range {
  start: Position;
  end: Position;
}

export interface Location {
  uri: DocumentUri;
  range: Range;
}

export interface LocationLink {
  originSelectionRange?: Range;
  targetUri: DocumentUri;
  targetRange: Range;
  targetSelectionRange: Range;
}

export interface RequestMessage {
  method: string;
  // deno-lint-ignore no-explicit-any
  params?: any[] | Record<string, any>;
}

export interface ResponseMessage<T = unknown, E = unknown> {
  result?: T;
  error?: ResponseError<E>;
}

export function isResponseMessage(x: unknown): x is ResponseMessage {
  if (!isObject(x)) return false;
  const { error } = x as ResponseMessage;
  return isUndefined(error) || isResponseError(error);
}

export interface ResponseError<T = unknown> {
  code: number;
  message: string;
  data?: T;
}

export function isResponseError(x: unknown): x is ResponseError {
  return isLike({ code: 1, message: "x" } satisfies ResponseError, x);
}

export function getErrorMessage(error: ResponseError): string {
  if (isObject(error.data) && isString(error.data.message)) {
    return error.data.message;
  }
  return error.message;
}

export interface TextDocumentPositionParams {
  textDocument: TextDocumentIdentifier;
  position: Position;
}

export interface ReferenceParams extends TextDocumentPositionParams {
  context: ReferenceContext;
}

export interface ReferenceContext {
  includeDeclaration: boolean;
}

export interface ReferenceRequestMessage extends RequestMessage {
  method: `textDocument/references`;
  params: ReferenceParams;
}

export const LIST_METHODS = [
  "declaration",
  "definition",
  "implementation",
  "references",
  "typeDefinition",
] as const;

export type LocationListMethod = typeof LIST_METHODS[number];

export function isLocationListMethod(x: unknown): x is LocationListMethod {
  return isString(x) && LIST_METHODS.includes(x as LocationListMethod);
}

export interface LocationListRequestMessage extends RequestMessage {
  method: `textDocument/${Exclude<LocationListMethod, "references">}`;
  params: TextDocumentPositionParams;
}

export type LocationListResult = Location | Location[] | LocationLink[] | null;
