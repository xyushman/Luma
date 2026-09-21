// Imports: mergeProps blends caller props, useRender enables polymorphic rendering, cva handles variants, cn merges classes.
import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

// cva variant map controlling the badge's preset styles.
const badgeVariants = cva(
  "group/badge inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden whitespace-nowrap rounded-4xl border border-transparent px-2 py-0.5 font-medium text-xs transition-all focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&>svg]:pointer-events-none [&>svg]:size-3!",
  {
    // Fall back to the default variant when none is passed by the caller.
    defaultVariants: {
      variant: "default",
    },
    variants: {
      variant: {
        // default: solid primary-colored badge.
        default: "bg-primary text-primary-foreground [a]:hover:bg-primary/80",
        // destructive: muted red badge used for error flags.
        destructive:
          "bg-destructive/10 text-destructive focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:focus-visible:ring-destructive/40 [a]:hover:bg-destructive/20",
        // ghost: borderless badge that only reveals a background on hover.
        ghost:
          "hover:bg-muted hover:text-muted-foreground dark:hover:bg-muted/50",
        // link: badge styled as an inline text link.
        link: "text-primary underline-offset-4 hover:underline",
        // outline: bordered badge with foreground text.
        outline:
          "border-border text-foreground [a]:hover:bg-muted [a]:hover:text-muted-foreground",
        // secondary: muted surface badge for auxiliary labels.
        secondary:
          "bg-secondary text-secondary-foreground [a]:hover:bg-secondary/80",
      },
    },
  }
);

// Badge: polymorphic span rendered via useRender; variant selects the class preset.
function Badge({
  className,
  variant = "default",
  render,
  ...props
}: useRender.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  // useRender takes a default tag plus a render override and forwards merged props and state.
  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(
      {
        className: cn(badgeVariants({ variant }), className),
      },
      props
    ),
    render,
    // Base UI state handed to the render prop: this element's slot and selected variant.
    state: {
      slot: "badge",
      variant,
    },
  });
}

export { Badge, badgeVariants };
