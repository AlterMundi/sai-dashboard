import { createContext, useContext, useState, useRef, useEffect, ReactNode, HTMLAttributes, forwardRef } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/utils';

interface SelectContextType {
  value: string;
  onValueChange: (value: string) => void;
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
  triggerRef: React.MutableRefObject<HTMLButtonElement | null>;
}

const SelectContext = createContext<SelectContextType | undefined>(undefined);

interface SelectProps {
  children: ReactNode;
  value: string;
  onValueChange: (value: string) => void;
  disabled?: boolean;
}

export function Select({ children, value, onValueChange, disabled }: SelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  return (
    <SelectContext.Provider value={{ value, onValueChange, isOpen, setIsOpen, triggerRef }}>
      <div className={cn("relative", disabled && "opacity-50 cursor-not-allowed")}>
        {children}
      </div>
    </SelectContext.Provider>
  );
}

interface SelectTriggerProps extends HTMLAttributes<HTMLButtonElement> {
  children?: ReactNode;
}

export const SelectTrigger = forwardRef<HTMLButtonElement, SelectTriggerProps>(
  ({ className, children, ...props }, ref) => {
    const context = useContext(SelectContext);
    if (!context) throw new Error('SelectTrigger must be used within Select');

    return (
      <button
        ref={(node) => {
          context.triggerRef.current = node;
          if (typeof ref === 'function') ref(node);
          else if (ref) ref.current = node;
        }}
        type="button"
        onClick={() => context.setIsOpen(!context.isOpen)}
        className={cn(
          "flex h-10 w-full items-center justify-between rounded-md border border-gray-300 bg-white px-3 py-2 text-sm placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        {...props}
      >
        {children}
        <ChevronDown className={cn("h-4 w-4 transition-transform", context.isOpen && "rotate-180")} />
      </button>
    );
  }
);

SelectTrigger.displayName = "SelectTrigger";

interface SelectValueProps {
  placeholder?: string;
}

export function SelectValue({ placeholder }: SelectValueProps) {
  const context = useContext(SelectContext);
  if (!context) throw new Error('SelectValue must be used within Select');

  return (
    <span className={cn(
      "block truncate",
      !context.value && "text-gray-500"
    )}>
      {context.value || placeholder}
    </span>
  );
}

interface SelectContentProps {
  children: ReactNode;
  className?: string;
}

export function SelectContent({ children, className }: SelectContentProps) {
  const context = useContext(SelectContext);
  if (!context) throw new Error('SelectContent must be used within Select');

  const [rect, setRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    if (context.isOpen && context.triggerRef.current) {
      setRect(context.triggerRef.current.getBoundingClientRect());
    }
  }, [context.isOpen, context.triggerRef]);

  if (!context.isOpen) return null;

  const style = rect
    ? { top: rect.bottom + 4, left: rect.left, width: rect.width }
    : { top: 0, left: 0, width: 200 };

  return createPortal(
    <>
      <div
        className="fixed inset-0 z-40"
        onClick={() => context.setIsOpen(false)}
      />
      <div
        className={cn(
          "fixed z-50 bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-auto",
          className
        )}
        style={style}
      >
        {children}
      </div>
    </>,
    document.body
  );
}

interface SelectItemProps {
  children: ReactNode;
  value: string;
  className?: string;
}

export function SelectItem({ children, value, className }: SelectItemProps) {
  const context = useContext(SelectContext);
  if (!context) throw new Error('SelectItem must be used within Select');

  const isSelected = context.value === value;

  return (
    <div
      className={cn(
        "relative flex w-full cursor-default select-none items-center rounded-sm py-2 px-3 text-sm outline-none hover:bg-gray-100 focus:bg-gray-100",
        isSelected && "bg-blue-100 text-blue-900",
        className
      )}
      onClick={() => {
        context.onValueChange(value);
        context.setIsOpen(false);
      }}
    >
      {children}
    </div>
  );
}
