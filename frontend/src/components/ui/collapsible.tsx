import React from "react";
import { cn } from "@/utils";

interface CollapsibleProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: React.ReactNode;
  className?: string;
}

const Collapsible: React.FC<CollapsibleProps> = ({ 
  open, 
  onOpenChange,
  children,
  className,
  ...props 
}) => (
  <div className={cn("collapsible", className)} {...props}>
    {children}
  </div>
);

interface CollapsibleTriggerProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  asChild?: boolean;
}

const CollapsibleTrigger = React.forwardRef<HTMLDivElement, CollapsibleTriggerProps>(
  ({ children, asChild, ...props }, ref) => {
    if (asChild) {
      return React.cloneElement(children as React.ReactElement, props);
    }
    return (
      <div ref={ref} {...props}>
        {children}
      </div>
    );
  }
);
CollapsibleTrigger.displayName = "CollapsibleTrigger";

interface CollapsibleContentProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

const CollapsibleContent = React.forwardRef<HTMLDivElement, CollapsibleContentProps>(
  ({ className, children, ...props }, ref) => (
    <div
      ref={ref}
      className={cn("collapsible-content", className)}
      {...props}
    >
      {children}
    </div>
  )
);
CollapsibleContent.displayName = "CollapsibleContent";

export { Collapsible, CollapsibleTrigger, CollapsibleContent };