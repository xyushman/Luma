// clsx joins conditional class strings while twMerge resolves conflicting
// Tailwind utilities (e.g. both "px-2 px-4" collapse to the last). Kept in
// utils.ts so every shadcn/ui component shares the same class-combining helper.
import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

// Combines Tailwind class names, keeping the last conflicting utility per property.
export function cn(...inputs: ClassValue[]) {
  // Accepts strings, arrays, and falsy conditionals
  return twMerge(clsx(inputs)); // clsx flattens inputs, twMerge dedupes Tailwind conflicts
}
