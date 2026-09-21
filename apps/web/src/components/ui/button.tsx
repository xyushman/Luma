// Imports: Base UI button primitive, cva for the variant maps, and cn for class merging.
import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

// cva map for button styling, driven by both the size and variant props.
const buttonVariants = cva(
  "group/button inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap rounded-full border border-transparent bg-clip-padding font-medium text-sm outline-none transition-all focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    // Fall back to the default size and variant when the caller passes neither.
    defaultVariants: {
      size: "default",
      variant: "default",
    },
    variants: {
      // size map: preset heights and paddings for xs up to lg, plus icon-only sizes.
      size: {
        default:
          "h-8 gap-1.5 px-3.5 has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3",
        icon: "size-8 rounded-full",
        "icon-lg": "size-9 rounded-full",
        "icon-sm":
          "size-7 in-data-[slot=button-group]:rounded-full rounded-full",
        "icon-xs":
          "size-6 in-data-[slot=button-group]:rounded-full rounded-full [&_svg:not([class*='size-'])]:size-3",
        lg: "h-9 gap-1.5 px-4.5 has-data-[icon=inline-end]:pr-3.5 has-data-[icon=inline-start]:pl-3.5",
        sm: "h-7 gap-1 in-data-[slot=button-group]:rounded-full rounded-full px-3 text-[0.8rem] has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 [&_svg:not([class*='size-'])]:size-3.5",
        xs: "h-6 gap-1 in-data-[slot=button-group]:rounded-full rounded-full px-2.5 text-xs has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 [&_svg:not([class*='size-'])]:size-3",
      },
      // variant map: tone presets from the solid default through ghost, link, outline, and secondary.
      variant: {
        default:
          "border border-primary/30 bg-gradient-to-b from-primary via-primary to-primary/85 text-primary-foreground shadow-[inset_0_1px_0_0_rgba(255,255,255,0.22),0_1px_2px_0_rgba(15,23,42,0.12)] hover:brightness-105 active:translate-y-[0.5px] active:shadow-[inset_0_1.5px_2px_rgba(0,0,0,0.18)]",
        destructive:
          "bg-destructive/10 text-destructive hover:bg-destructive/20 focus-visible:border-destructive/40 focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:focus-visible:ring-destructive/40 dark:hover:bg-destructive/30",
        ghost:
          "hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:hover:bg-muted/50",
        link: "text-primary underline-offset-4 hover:underline",
        outline:
          "border-border bg-background hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)] aria-expanded:bg-secondary aria-expanded:text-secondary-foreground",
      },
    },
  }
);

// Button: Base UI button that applies the cva-produced classes to a native-accessible element.
function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      className={cn(buttonVariants({ className, size, variant }))}
      data-slot="button"
      {...props}
    />
  );
}

export { Button, buttonVariants };
