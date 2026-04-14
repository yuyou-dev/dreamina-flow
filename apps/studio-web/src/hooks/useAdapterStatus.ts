import { useCallback, useState } from "react";
import { fetchAdapterStatus } from "../lib/api";
import type { AdapterStatus } from "../types";

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export function useAdapterStatus({ onError }: { onError: (message: string) => void }) {
  const [runtimeStatus, setRuntimeStatus] = useState<AdapterStatus | null>(null);

  const refreshRuntimeStatus = useCallback(async () => {
    try {
      const status = await fetchAdapterStatus();
      setRuntimeStatus(status);
      return status;
    } catch (error) {
      onError(errorMessage(error, "Failed to refresh adapter status."));
      return null;
    }
  }, [onError]);

  return {
    runtimeStatus,
    refreshRuntimeStatus,
  };
}
