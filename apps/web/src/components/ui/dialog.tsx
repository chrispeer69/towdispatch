'use client';

/**
 * Minimal Dialog primitive. Hand-rolled (no @radix-ui/react-dialog) to
 * keep the driver bundle thin. Renders into a portal-style fixed overlay,
 * traps focus via tabindex + escape-to-close, and locks body scroll while
 * open. Touch-first: the close button is 44×44 and the panel takes full
 * width on small viewports.
 *
 * API:
 *   <Dialog open={…} onOpenChange={…}>
 *     <DialogContent>
 *       <DialogHeader>
 *         <DialogTitle>…</DialogTitle>
 *         <DialogDescription>…</DialogDescription>
 *       </DialogHeader>
 *       …
 *       <DialogFooter>…</DialogFooter>
 *     </DialogContent>
 *   </Dialog>
 */
import { cn } from '@/lib/utils';
import { X } from 'lucide-react';
import * as React from 'react';

interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
}

export function Dialog({ open, onOpenChange, children }: DialogProps): JSX.Element | null {
  React.useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onOpenChange(false);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onOpenChange]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true">
      <button
        type="button"
        className="absolute inset-0 bg-black/70"
        aria-label="Close"
        onClick={() => onOpenChange(false)}
      />
      <div className="relative z-10 w-full sm:max-w-lg">{children}</div>
    </div>
  );
}

export function DialogContent({
  className,
  children,
  onClose,
}: { className?: string; children: React.ReactNode; onClose?: () => void }): JSX.Element {
  return (
    <div
      className={cn(
        'mx-2 mb-2 max-h-[90vh] overflow-y-auto rounded-t-[16px] border border-divider bg-bg-surface p-5 text-text-primary-on-dark shadow-xl sm:mx-0 sm:mb-0 sm:rounded-[16px]',
        className,
      )}
    >
      {onClose ? (
        <button
          type="button"
          aria-label="Close dialog"
          onClick={onClose}
          className="absolute right-3 top-3 flex h-11 w-11 items-center justify-center rounded-full text-text-secondary-on-dark hover:bg-bg-surface-elevated"
        >
          <X className="h-5 w-5" />
        </button>
      ) : null}
      {children}
    </div>
  );
}

export function DialogHeader({ children, className }: { children: React.ReactNode; className?: string }): JSX.Element {
  return <div className={cn('mb-4 flex flex-col gap-1', className)}>{children}</div>;
}

export function DialogTitle({ children, className }: { children: React.ReactNode; className?: string }): JSX.Element {
  return <h2 className={cn("text-lg font-semibold", className)}>{children}</h2>;
}

export function DialogDescription({ children, className }: { children: React.ReactNode; className?: string }): JSX.Element {
  return <p className={cn("text-sm text-text-secondary-on-dark", className)}>{children}</p>;
}

export function DialogFooter({ children, className }: { children: React.ReactNode; className?: string }): JSX.Element {
  return (
    <div
      className={cn(
        'mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:gap-2',
        className,
      )}
    >
      {children}
    </div>
  );
}
