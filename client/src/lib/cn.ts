import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

// shadcn/ui pattern: clsx composes conditional classes, twMerge resolves conflicts ("p-2 p-4" -> "p-4").
export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));
