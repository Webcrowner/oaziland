export function replyTimeLabel(hours: number): string {
  if (hours < 1) return "Usually replies within an hour";
  if (hours < 24) return `Usually replies within ${Math.ceil(hours)} hours`;
  return `Usually replies within ${Math.ceil(hours / 24)} days`;
}

export function lastSeenLabel(iso: string, now: Date = new Date()): string {
  const minutes = Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 60000));
  if (minutes < 5) return "Active now";
  if (minutes < 60) return `Last seen ${minutes} minutes ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `Last seen ${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  const days = Math.round(hours / 24);
  return `Last seen ${days} ${days === 1 ? "day" : "days"} ago`;
}

export function memberSinceLabel(date: string): string {
  return `Member since ${new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { month: "long", year: "numeric" })}`;
}
