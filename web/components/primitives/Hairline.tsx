import { cn } from "@/lib/cn";

export function Hairline({
  className,
  vertical = false,
}: {
  className?: string;
  vertical?: boolean;
}) {
  return (
    <div
      aria-hidden
      className={cn(
        "bg-rule",
        vertical ? "w-px h-full" : "h-px w-full",
        className,
      )}
    />
  );
}
