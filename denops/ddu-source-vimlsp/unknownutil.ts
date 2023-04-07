export * from "https://deno.land/x/unknownutil@v2.1.0/mod.ts";
import {
  AssertError,
  type Predicate,
} from "https://deno.land/x/unknownutil@v2.1.0/mod.ts";

const DEFAULT_ASSERT_MESSAGE = "The value is not expected type";

export function assertIt<T>(
  x: unknown,
  pred: Predicate<T>,
  message = DEFAULT_ASSERT_MESSAGE,
): asserts x is T {
  if (!pred(x)) {
    throw new AssertError(message);
  }
}

export function ensureIt<T>(
  x: unknown,
  pred: Predicate<T>,
  message = DEFAULT_ASSERT_MESSAGE,
): T {
  assertIt(x, pred, message);
  return x;
}

export function maybeIt<T>(x: unknown, pred: Predicate<T>): T | undefined {
  return pred(x) ? x : void 0;
}

export function assertParameter<T>(
  name: string,
  value: unknown,
  pred: Predicate<T>,
): asserts value is T {
  const message = `Invalid parameter: ${name}: ${JSON.stringify(value)}`;
  assertIt(value, pred, message);
}
