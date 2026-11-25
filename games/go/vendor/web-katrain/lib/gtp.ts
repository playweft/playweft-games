export function formatGtpMove(x: number, y: number, size = 19): string {
  return x < 0 || y < 0 ? "pass" : `${"ABCDEFGHJKLMNOPQRST"[x]}${size - y}`;
}
