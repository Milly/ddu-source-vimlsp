export const encoder = new TextEncoder();
export const encode = encoder.encode.bind(encoder);

export function getByteLength(s: string): number {
  return encode(s).length;
}
