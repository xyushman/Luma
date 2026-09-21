// Imports: React types, the shared Label primitive, and cn; these wrappers are consumed by react-hook-form forms.
import type * as React from "react";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

// Form: styled <form> wrapper that adds vertical spacing between form items.
const Form = ({
  className,
  ref,
  ...props
}: React.FormHTMLAttributes<HTMLFormElement> & {
  ref?: React.RefObject<HTMLFormElement | null>;
}) => <form className={cn("space-y-6", className)} ref={ref} {...props} />;
Form.displayName = "Form"; // readable name shown in React DevTools.

// FormItem: wrapper that spaces a single label/control/message group.
const FormItem = ({
  className,
  ref,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & {
  ref?: React.RefObject<HTMLDivElement | null>;
}) => <div className={cn("space-y-2", className)} ref={ref} {...props} />;
FormItem.displayName = "FormItem"; // readable name shown in React DevTools.

// FormLabel: forwards to the Label primitive with merged styles.
const FormLabel = ({
  className,
  ref,
  ...props
}: React.ComponentPropsWithoutRef<typeof Label> & {
  ref?: React.RefObject<HTMLLabelElement | null>;
}) => <Label className={cn(className)} ref={ref} {...props} />;
FormLabel.displayName = "FormLabel"; // readable name shown in React DevTools.

// FormControl: pass-through slot that owns arbitrary field markup.
const FormControl = ({
  ref,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & {
  ref?: React.RefObject<HTMLDivElement | null>;
}) => <div ref={ref} {...props} />;
FormControl.displayName = "FormControl"; // readable name shown in React DevTools.

// FormDescription: helper text rendered under the field.
const FormDescription = ({
  className,
  ref,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement> & {
  ref?: React.RefObject<HTMLParagraphElement | null>;
}) => (
  <p
    className={cn("text-muted-foreground text-sm", className)}
    ref={ref}
    {...props}
  />
);
FormDescription.displayName = "FormDescription"; // readable name shown in React DevTools.

// FormMessage: validation error text; hidden entirely when there is no message.
const FormMessage = ({
  className,
  children,
  ref,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement> & {
  ref?: React.RefObject<HTMLParagraphElement | null>;
}) => {
  // Render nothing for an empty message so there is no stray spacing or red text.
  if (!children) {
    return null;
  }
  return (
    <p
      className={cn("font-medium text-destructive text-sm", className)}
      ref={ref}
      {...props}
    >
      {children}
    </p>
  );
};
FormMessage.displayName = "FormMessage"; // readable name shown in React DevTools.

export { Form, FormControl, FormDescription, FormItem, FormLabel, FormMessage };
