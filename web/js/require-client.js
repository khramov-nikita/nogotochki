import { ApiError, getMe } from "./api.js";
import { currentPageForNext } from "./store.js";

export async function requireClient() {
  try {
    const body = await getMe();
    if (body?.client) {
      return body.client;
    }
  } catch (error) {
    if (!(error instanceof ApiError && error.status === 401)) {
      throw error;
    }
  }
  const next = encodeURIComponent(currentPageForNext());
  window.location.replace(`auth.html?next=${next}`);
  return null;
}
