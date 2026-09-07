export function streamReconnectDelayMs(attempt: number, random = Math.random): number {
  const boundedAttempt = Math.max(0, Math.min(6, Math.trunc(attempt)));
  const ceiling = Math.min(30_000, 1_500 * 2 ** boundedAttempt);
  return Math.round(ceiling * (0.65 + Math.max(0, Math.min(1, random())) * 0.35));
}

export function appendBoundedStreamMessage<T>(messages: T[], message: T, limit = 500): number {
  messages.push(message);
  const overflow = Math.max(0, messages.length - Math.max(1, limit));
  if (overflow > 0) messages.splice(0, overflow);
  return overflow;
}
