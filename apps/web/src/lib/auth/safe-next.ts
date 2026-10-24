/**
 * Validates a post-login "return to" path. Only workspace paths on THIS site are accepted;
 * absolute URLs, protocol-relative "//evil.example", backslashes and other tricks fall back to
 * /app. This prevents open-redirect phishing ("log in here, then get sent to a fake site").
 */
export function safeNext(value: string | null | undefined): string {
  return value && /^\/app(\/[A-Za-z0-9\-_/]*)?(\?[A-Za-z0-9=&\-_%]*)?$/.test(value) && !value.includes("//") ? value : "/app";
}
