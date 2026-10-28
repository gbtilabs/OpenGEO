import { useCallback, useEffect, useRef } from 'react';

export type EditState = { dirty: boolean; busy: boolean };
const pendingOwners = new Set<symbol>();

/** A form must not clear another editor's desktop restart protection. */
export function useCloseProtection(pending: boolean) {
  const owner = useRef(Symbol());
  const update = useCallback((value: boolean) => {
    if (value) pendingOwners.add(owner.current); else pendingOwners.delete(owner.current);
    window.opengeoDesktop?.setDraftProtectionPending(pendingOwners.size > 0);
  }, []);
  useEffect(() => {
    const id = owner.current;
    update(pending);
    const guard = (event: BeforeUnloadEvent) => {
      if (pendingOwners.has(id)) { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('beforeunload', guard);
    return () => {
      window.removeEventListener('beforeunload', guard);
      pendingOwners.delete(id);
      window.opengeoDesktop?.setDraftProtectionPending(pendingOwners.size > 0);
    };
  }, [pending, update]);
  return update;
}
