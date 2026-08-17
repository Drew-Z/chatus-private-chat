import type { MemberModelAvailability } from "./api";

export type ModelAvailabilityViewState = {
  status: "loading" | "success" | "empty" | "stale" | "error";
  data: MemberModelAvailability | null;
  refreshing: boolean;
  error: string;
};

export function createModelAvailabilityViewState(): ModelAvailabilityViewState {
  return { status: "loading", data: null, refreshing: true, error: "" };
}

export function beginModelAvailabilityRefresh(
  state: ModelAvailabilityViewState,
): ModelAvailabilityViewState {
  return state.data
    ? { ...state, refreshing: true }
    : { status: "loading", data: null, refreshing: true, error: "" };
}

export function completeModelAvailabilityRefresh(
  data: MemberModelAvailability,
): ModelAvailabilityViewState {
  return {
    status: data.routes.length === 0 ? "empty" : "success",
    data,
    refreshing: false,
    error: "",
  };
}

export function failModelAvailabilityRefresh(
  state: ModelAvailabilityViewState,
  error: string,
): ModelAvailabilityViewState {
  return state.data
    ? { ...state, status: "stale", refreshing: false, error }
    : { status: "error", data: null, refreshing: false, error };
}
