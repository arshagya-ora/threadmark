import { API_URL } from "./config";

export async function api<T>(path: string, init?: RequestInit, timeout = 15000): Promise<T> {
  let response: Response;
  try {
    response = await fetch(API_URL + path, { ...init, signal: init?.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(timeout)]) : AbortSignal.timeout(timeout) });
  } catch (error) {
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
      throw new Error("The request took too long. Refresh the library to check its status, or retry.");
    }
    throw new Error("Cannot reach the backend. Check that it is running, then retry. The sample works offline.");
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(typeof data?.detail === "string" ? data.detail : "The request failed. Please retry.");
  }
  return data as T;
}
