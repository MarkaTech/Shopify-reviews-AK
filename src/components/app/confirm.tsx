'use client';

import React, { createContext, useCallback, useContext, useRef, useState } from 'react';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';

/**
 * Confirmation for actions that cannot be undone.
 *
 * Six of them shipped without one: deleting a review singly and in bulk, deleting a
 * question, a widget, an incentive, and "Reset to defaults", which wipes every storefront
 * setting a merchant has configured. All were a single click, all unrecoverable, and
 * `alert-dialog.tsx` was already in the repo, imported by nothing.
 *
 * Promise-based rather than a component per call site. Six copies of open/close state,
 * a pending-id ref and eleven lines of dialog markup is how the seventh destructive
 * action ends up shipping without one — the cost of doing it right has to be one line:
 *
 *   if (!(await confirm({ title: '…', body: '…' }))) return;
 *
 * The wording matters as much as the dialog. `body` should say what is lost and whether
 * it comes back, and `confirmLabel` should name the act — "Delete review", not "OK" —
 * so the button still reads correctly to someone who skipped the paragraph.
 */

interface ConfirmOptions {
  title: string;
  body?: React.ReactNode;
  /** Names the act. Defaults to a bare "Delete", which is worth overriding. */
  confirmLabel?: string;
  cancelLabel?: string;
  /** `danger` for anything destructive, which is nearly always why you are here. */
  tone?: 'danger' | 'default';
}

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

export function useConfirm(): ConfirmFn {
  const fn = useContext(ConfirmContext);
  if (!fn) throw new Error('useConfirm must be used inside <ConfirmProvider>');
  return fn;
}

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  // Held in a ref, not state: resolving is not a render concern, and keeping it out of
  // state means answering the dialog cannot race a re-render.
  const resolver = useRef<((ok: boolean) => void) | null>(null);

  const confirm = useCallback<ConfirmFn>((next) => {
    return new Promise<boolean>((resolve) => {
      // A second request while one is open would strand the first caller's promise
      // forever, and an awaited promise that never settles is a hung UI with no error.
      resolver.current?.(false);
      resolver.current = resolve;
      setOpts(next);
    });
  }, []);

  const settle = useCallback((ok: boolean) => {
    resolver.current?.(ok);
    resolver.current = null;
    setOpts(null);
  }, []);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <AlertDialog
        open={opts !== null}
        // Covers Escape and the overlay click as well as the Cancel button. Any exit
        // that is not the confirm button has to mean no.
        onOpenChange={(open) => { if (!open) settle(false); }}
      >
        <AlertDialogContent className="rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-[16px]">{opts?.title}</AlertDialogTitle>
            {opts?.body && (
              <AlertDialogDescription className="text-[13px] leading-relaxed">
                {opts.body}
              </AlertDialogDescription>
            )}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-xl" onClick={() => settle(false)}>
              {opts?.cancelLabel ?? 'Cancel'}
            </AlertDialogCancel>
            <AlertDialogAction
              className={cn(
                'rounded-xl',
                opts?.tone !== 'default' && 'bg-rose-600 text-white hover:bg-rose-700 focus-visible:ring-rose-600/30'
              )}
              onClick={() => settle(true)}
            >
              {opts?.confirmLabel ?? 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ConfirmContext.Provider>
  );
}
